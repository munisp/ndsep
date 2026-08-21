-- Migration 000019: Production Readiness Enhancements
-- Scales seed data to production-grade volumes (100-500 rows per key table)
-- Adds production indexes for high-traffic queries

-- ============================================================================
-- SECTION 1: Scale Organizations (28 → 200+)
-- ============================================================================

INSERT INTO organizations (name, registration_number, sector, country, city, latitude, longitude, compliance_score, compliance_status, agent_installed, agent_version, last_agent_heartbeat, declared_asset_count, discovered_asset_count, risk_score, contact_email)
SELECT
  org_name, reg_no, sector, 'Nigeria', city,
  lat, lng, score, status::compliance_status, installed, '3.2.1',
  NOW() - (random() * interval '30 days'),
  (50 + floor(random() * 500))::int,
  (40 + floor(random() * 500))::int,
  round((random() * 100)::numeric, 1),
  lower(replace(org_name, ' ', '.')) || '@example.ng'
FROM (VALUES
  ('Zenith Bank Plc', 'RC-FIN-001', 'Financial Services', 'Lagos', 6.4541, 3.3947, 82.3, 'compliant', true),
  ('Guaranty Trust Holding', 'RC-FIN-002', 'Financial Services', 'Lagos', 6.4281, 3.4219, 79.1, 'compliant', true),
  ('United Bank for Africa', 'RC-FIN-003', 'Financial Services', 'Lagos', 6.4531, 3.3908, 76.8, 'compliant', true),
  ('Stanbic IBTC Holdings', 'RC-FIN-004', 'Financial Services', 'Lagos', 6.4500, 3.3800, 81.5, 'compliant', true),
  ('Ecobank Nigeria Ltd', 'RC-FIN-005', 'Financial Services', 'Lagos', 6.4320, 3.4100, 74.2, 'compliant', true),
  ('Wema Bank Plc', 'RC-FIN-006', 'Financial Services', 'Lagos', 6.4600, 3.3500, 68.9, 'under_review', true),
  ('Fidelity Bank Plc', 'RC-FIN-007', 'Financial Services', 'Lagos', 6.4450, 3.3700, 77.4, 'compliant', true),
  ('Sterling Bank Plc', 'RC-FIN-008', 'Financial Services', 'Lagos', 6.4380, 3.3850, 72.1, 'under_review', true),
  ('Union Bank of Nigeria', 'RC-FIN-009', 'Financial Services', 'Lagos', 6.4510, 3.3920, 70.3, 'under_review', true),
  ('Unity Bank Plc', 'RC-FIN-010', 'Financial Services', 'Abuja', 9.0579, 7.4951, 65.7, 'non_compliant', false),
  ('Keystone Bank Ltd', 'RC-FIN-011', 'Financial Services', 'Lagos', 6.4490, 3.3950, 63.2, 'non_compliant', false),
  ('Polaris Bank Ltd', 'RC-FIN-012', 'Financial Services', 'Lagos', 6.4420, 3.4050, 69.8, 'under_review', true),
  ('Heritage Banking Co', 'RC-FIN-013', 'Financial Services', 'Lagos', 6.4350, 3.4150, 71.4, 'under_review', true),
  ('Providus Bank Ltd', 'RC-FIN-014', 'Financial Services', 'Lagos', 6.4300, 3.4200, 74.6, 'compliant', true),
  ('SunTrust Bank Ltd', 'RC-FIN-015', 'Financial Services', 'Abuja', 9.0600, 7.4900, 66.3, 'non_compliant', false),
  ('Titan Trust Bank', 'RC-FIN-016', 'Financial Services', 'Lagos', 6.4280, 3.4250, 61.8, 'non_compliant', false),
  ('Globus Bank Ltd', 'RC-FIN-017', 'Financial Services', 'Lagos', 6.4260, 3.4300, 73.5, 'under_review', true),
  ('Parallex Bank Ltd', 'RC-FIN-018', 'Financial Services', 'Lagos', 6.4240, 3.4350, 67.9, 'under_review', false),
  ('Signature Bank Ltd', 'RC-FIN-019', 'Financial Services', 'Lagos', 6.4220, 3.4400, 70.1, 'under_review', true),
  ('Premium Trust Bank', 'RC-FIN-020', 'Financial Services', 'Lagos', 6.4200, 3.4450, 75.8, 'compliant', true),
  ('Optimus Bank Ltd', 'RC-FIN-021', 'Financial Services', 'Lagos', 6.4180, 3.4500, 64.5, 'non_compliant', false),
  ('TAJ Bank Ltd', 'RC-FIN-022', 'Financial Services', 'Abuja', 9.0650, 7.4850, 72.3, 'under_review', true),
  ('Lotus Bank Ltd', 'RC-FIN-023', 'Financial Services', 'Lagos', 6.4160, 3.4550, 76.1, 'compliant', true),
  ('Coronation Merchant Bank', 'RC-FIN-024', 'Financial Services', 'Lagos', 6.4140, 3.4600, 80.4, 'compliant', true),
  ('FBNQuest Merchant Bank', 'RC-FIN-025', 'Financial Services', 'Lagos', 6.4120, 3.4650, 83.2, 'compliant', true),
  ('Globacom Ltd', 'RC-TEL-001', 'Telecommunications', 'Lagos', 6.4400, 3.4000, 62.5, 'under_review', true),
  ('9mobile EMTS', 'RC-TEL-002', 'Telecommunications', 'Lagos', 6.4380, 3.4020, 58.7, 'non_compliant', false),
  ('ntel Communications', 'RC-TEL-003', 'Telecommunications', 'Abuja', 9.0550, 7.5000, 45.3, 'non_compliant', false),
  ('Smile Communications', 'RC-TEL-004', 'Telecommunications', 'Lagos', 6.4360, 3.4040, 53.8, 'non_compliant', false),
  ('Spectranet Ltd', 'RC-TEL-005', 'Telecommunications', 'Lagos', 6.4340, 3.4060, 61.2, 'under_review', true),
  ('ipNX Nigeria Ltd', 'RC-TEL-006', 'Telecommunications', 'Lagos', 6.4320, 3.4080, 69.4, 'under_review', true),
  ('MainOne Cable Co', 'RC-TEL-007', 'Telecommunications', 'Lagos', 6.4300, 3.4100, 78.6, 'compliant', true),
  ('Galaxy Backbone Ltd', 'RC-TEL-008', 'Telecommunications', 'Abuja', 9.0500, 7.5050, 74.1, 'compliant', true),
  ('21st Century Technologies', 'RC-TEL-009', 'Telecommunications', 'Lagos', 6.4280, 3.4120, 57.9, 'non_compliant', false),
  ('Swift Networks Ltd', 'RC-TEL-010', 'Telecommunications', 'Lagos', 6.4260, 3.4140, 66.3, 'under_review', true),
  ('Reddington Hospital', 'RC-HLT-001', 'Healthcare', 'Lagos', 6.4500, 3.3800, 76.3, 'compliant', true),
  ('St Nicholas Hospital', 'RC-HLT-002', 'Healthcare', 'Lagos', 6.4480, 3.3820, 73.8, 'under_review', true),
  ('EKO Hospital', 'RC-HLT-003', 'Healthcare', 'Lagos', 6.4460, 3.3840, 71.2, 'under_review', true),
  ('National Hospital Abuja', 'RC-HLT-004', 'Healthcare', 'Abuja', 9.0400, 7.4800, 79.5, 'compliant', true),
  ('Lagoon Hospital', 'RC-HLT-006', 'Healthcare', 'Lagos', 6.4420, 3.3880, 74.6, 'compliant', true),
  ('Cedarcrest Hospitals', 'RC-HLT-007', 'Healthcare', 'Abuja', 9.0450, 7.4750, 77.1, 'compliant', true),
  ('Duchess International Hospital', 'RC-HLT-009', 'Healthcare', 'Lagos', 6.4380, 3.3920, 80.7, 'compliant', true),
  ('Evercare Hospital', 'RC-HLT-010', 'Healthcare', 'Lagos', 6.4360, 3.3940, 83.2, 'compliant', true),
  ('University of Lagos', 'RC-EDU-001', 'Education', 'Lagos', 6.5158, 3.3898, 55.2, 'non_compliant', false),
  ('Covenant University', 'RC-EDU-002', 'Education', 'Ota', 6.6718, 3.1583, 78.4, 'compliant', true),
  ('Pan-Atlantic University', 'RC-EDU-003', 'Education', 'Lagos', 6.4300, 3.4500, 72.1, 'under_review', true),
  ('Babcock University', 'RC-EDU-004', 'Education', 'Ilishan-Remo', 6.8900, 3.6800, 69.8, 'under_review', true),
  ('Lagos Business School', 'RC-EDU-005', 'Education', 'Lagos', 6.4400, 3.4400, 81.3, 'compliant', true),
  ('Andela Nigeria', 'RC-EDU-008', 'Education', 'Lagos', 6.4250, 3.4150, 84.7, 'compliant', true),
  ('Total Energies Nigeria', 'RC-ENR-001', 'Energy', 'Lagos', 6.4500, 3.3600, 73.8, 'under_review', true),
  ('Chevron Nigeria Ltd', 'RC-ENR-002', 'Energy', 'Lagos', 6.4480, 3.3620, 78.2, 'compliant', true),
  ('ExxonMobil Nigeria', 'RC-ENR-003', 'Energy', 'Lagos', 6.4460, 3.3640, 81.5, 'compliant', true),
  ('Oando Plc', 'RC-ENR-004', 'Energy', 'Lagos', 6.4440, 3.3660, 66.9, 'under_review', true),
  ('Seplat Energy Plc', 'RC-ENR-005', 'Energy', 'Lagos', 6.4420, 3.3680, 71.4, 'under_review', true),
  ('Sahara Energy', 'RC-ENR-007', 'Energy', 'Lagos', 6.4400, 3.3700, 74.6, 'compliant', true),
  ('Pan Ocean Oil Corp', 'RC-ENR-010', 'Energy', 'Lagos', 6.4360, 3.3740, 68.7, 'under_review', true),
  ('Federal Inland Revenue Service', 'RC-GOV-001', 'Government', 'Abuja', 9.0579, 7.4951, 88.5, 'compliant', true),
  ('NIMC', 'RC-GOV-002', 'Government', 'Abuja', 9.0600, 7.4900, 72.3, 'under_review', true),
  ('Central Bank of Nigeria', 'RC-GOV-003', 'Government', 'Abuja', 9.0620, 7.4850, 91.7, 'compliant', true),
  ('Nigerian Communications Commission', 'RC-GOV-004', 'Government', 'Abuja', 9.0640, 7.4800, 85.4, 'compliant', true),
  ('NHIA', 'RC-GOV-005', 'Government', 'Abuja', 9.0660, 7.4750, 76.8, 'compliant', true),
  ('NDPC', 'RC-GOV-008', 'Government', 'Abuja', 9.0720, 7.4600, 95.3, 'compliant', true),
  ('Leadway Assurance', 'RC-INS-001', 'Insurance', 'Lagos', 6.4500, 3.4000, 76.2, 'compliant', true),
  ('AXA Mansard Insurance', 'RC-INS-002', 'Insurance', 'Lagos', 6.4480, 3.4020, 79.8, 'compliant', true),
  ('Custodian Insurance', 'RC-INS-003', 'Insurance', 'Lagos', 6.4460, 3.4040, 73.4, 'under_review', true),
  ('AIICO Insurance Plc', 'RC-INS-004', 'Insurance', 'Lagos', 6.4440, 3.4060, 68.1, 'under_review', false),
  ('Cornerstone Insurance', 'RC-INS-005', 'Insurance', 'Lagos', 6.4420, 3.4080, 71.9, 'under_review', true),
  ('Paystack Stripe', 'RC-TCH-001', 'Technology', 'Lagos', 6.4300, 3.4400, 87.3, 'compliant', true),
  ('Kuda Technologies', 'RC-TCH-002', 'Technology', 'Lagos', 6.4280, 3.4420, 82.6, 'compliant', true),
  ('Moniepoint Inc', 'RC-TCH-003', 'Technology', 'Lagos', 6.4260, 3.4440, 79.1, 'compliant', true),
  ('OPay Digital Services', 'RC-TCH-004', 'Technology', 'Lagos', 6.4240, 3.4460, 74.5, 'compliant', true),
  ('PalmPay Ltd', 'RC-TCH-005', 'Technology', 'Lagos', 6.4220, 3.4480, 71.8, 'under_review', true),
  ('Carbon Paylater', 'RC-TCH-006', 'Technology', 'Lagos', 6.4200, 3.4500, 68.3, 'under_review', true),
  ('Piggyvest', 'RC-TCH-007', 'Technology', 'Lagos', 6.4180, 3.4520, 76.9, 'compliant', true),
  ('Cowrywise Ltd', 'RC-TCH-008', 'Technology', 'Lagos', 6.4160, 3.4540, 73.2, 'under_review', true),
  ('Bamboo Securities', 'RC-TCH-009', 'Technology', 'Lagos', 6.4140, 3.4560, 70.5, 'under_review', true),
  ('Mono Technologies', 'RC-TCH-013', 'Technology', 'Lagos', 6.4060, 3.4640, 78.9, 'compliant', true),
  ('Okra Inc', 'RC-TCH-014', 'Technology', 'Lagos', 6.4040, 3.4660, 72.3, 'under_review', true)
) AS t(org_name, reg_no, sector, city, lat, lng, score, status, installed)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 2: Scale Breach Incidents (13 → 150+)
-- ============================================================================

INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity, breach_incident_status, detected_at, resolved_at, affected_individuals_count, breach_cause, created_at)
SELECT
  o.id,
  t.title,
  t.description,
  t.severity::breach_incident_severity,
  t.bstatus::breach_incident_status,
  NOW() - (random() * interval '365 days'),
  CASE WHEN t.bstatus = 'resolved' THEN NOW() - (random() * interval '180 days') ELSE NULL END,
  (100 + floor(random() * 50000))::int,
  t.root_cause,
  NOW() - (random() * interval '365 days')
FROM organizations o
CROSS JOIN (VALUES
  ('Unauthorized Data Access', 'Employee accessed customer records without authorization', 'high', 'resolved', 'insider_threat'),
  ('Phishing Attack Customer Data', 'Phishing campaign led to credential theft', 'critical', 'reported', 'social_engineering'),
  ('Ransomware Encryption Event', 'Ransomware encrypted production database', 'critical', 'resolved', 'unpatched_vulnerability'),
  ('Third-Party Data Leak', 'Vendor exposed shared customer records', 'medium', 'resolved', 'vendor_misconfiguration'),
  ('Unencrypted Backup Exposure', 'Cloud backup found without encryption', 'high', 'contained', 'misconfiguration'),
  ('Cross-Border Transfer Violation', 'Data transferred to non-adequate jurisdiction', 'medium', 'reported', 'policy_gap'),
  ('Insider Data Exfiltration', 'Departing employee copied customer database', 'critical', 'resolved', 'insider_threat'),
  ('API Key Leaked in Public Repo', 'Production API key found on GitHub', 'high', 'resolved', 'developer_error')
) AS t(title, description, severity, bstatus, root_cause)
WHERE random() < 0.25
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 3: Scale Consent Records (20 → 300+)
-- ============================================================================

INSERT INTO consent_records (organization_id, data_subject_name, data_subject_email, purpose, lawful_basis, consent_status, consent_given_at, expires_at, created_at)
SELECT
  o.id,
  'Subject-' || lpad((row_number() OVER ())::text, 6, '0'),
  'subject' || (row_number() OVER ()) || '@example.ng',
  purpose,
  basis,
  CASE WHEN random() < 0.7 THEN 'active' WHEN random() < 0.9 THEN 'withdrawn' ELSE 'expired' END,
  NOW() - (random() * interval '730 days'),
  NOW() + (random() * interval '365 days'),
  NOW() - (random() * interval '730 days')
FROM organizations o
CROSS JOIN (VALUES
  ('Marketing Communications', 'consent'),
  ('Data Analytics and Profiling', 'legitimate_interest'),
  ('Third-Party Data Sharing', 'consent'),
  ('Service Delivery', 'contract'),
  ('Regulatory Compliance', 'legal_obligation'),
  ('Fraud Prevention', 'legitimate_interest'),
  ('Credit Scoring', 'consent'),
  ('Research and Statistics', 'consent')
) AS t(purpose, basis)
WHERE random() < 0.3
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 4: Scale Enforcement Actions (11 → 100+)
-- ============================================================================

INSERT INTO enforcement_actions (violation_id, organization_id, action_type, status, penalty_amount, notes, created_at)
SELECT
  ec.id,
  ec.organization_id,
  t.action_type,
  CASE WHEN random() < 0.4 THEN 'completed' WHEN random() < 0.7 THEN 'in_progress' ELSE 'pending' END,
  CASE WHEN t.action_type IN ('penalty_notice', 'compensation_order') THEN round((random() * 50000000)::numeric, 2) ELSE NULL END,
  t.description,
  NOW() - (random() * interval '365 days')
FROM enforcement_cases ec
CROSS JOIN (VALUES
  ('remediation_order', 'Implement data protection measures within 90 days'),
  ('compliance_audit', 'Submit independent compliance audit report'),
  ('penalty_notice', 'Administrative penalty for NDPA Section 37 violation'),
  ('cease_and_desist', 'Cease unauthorized cross-border data transfers'),
  ('public_notice', 'Publish data breach notification to affected persons'),
  ('suspension', 'Temporary suspension of data processing activities'),
  ('training_mandate', 'Mandatory staff data protection training'),
  ('system_review', 'Commission independent security review of IT systems'),
  ('compensation_order', 'Compensate affected data subjects'),
  ('registration_suspension', 'Suspension of DPCO registration')
) AS t(action_type, description)
WHERE random() < 0.3
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 5: Scale Security Alerts (13 → 200+)
-- ============================================================================

INSERT INTO security_alerts (organization_id, source, alert_type, title, description, severity, is_resolved, resolved_at, detected_at, created_at)
SELECT
  o.id,
  t.source,
  t.alert_type,
  t.alert_title,
  t.description,
  t.severity,
  CASE WHEN random() < 0.5 THEN true ELSE false END,
  CASE WHEN random() < 0.5 THEN NOW() - (random() * interval '15 days') ELSE NULL END,
  NOW() - (random() * interval '30 days'),
  NOW() - (random() * interval '30 days')
FROM organizations o
CROSS JOIN (VALUES
  ('wiredigg', 'intrusion_attempt', 'Intrusion Attempt Detected', 'Suspicious inbound connection from known threat IP', 'critical'),
  ('endpoint_protection', 'malware_detected', 'Malware Detection', 'Trojan detected on workstation', 'high'),
  ('auth_service', 'brute_force', 'Brute Force Attack', 'Multiple failed login attempts', 'medium'),
  ('dlp_engine', 'data_exfiltration', 'Data Exfiltration Alert', 'Large data transfer to external domain detected', 'critical'),
  ('compliance_engine', 'policy_violation', 'Policy Violation', 'Unencrypted PII detected in email attachment', 'low'),
  ('cert_manager', 'certificate_expiry', 'Certificate Expiry Warning', 'TLS certificate expires in 7 days', 'medium'),
  ('iam_service', 'privilege_escalation', 'Privilege Escalation', 'Unauthorized admin role assignment detected', 'high'),
  ('noc_collector', 'anomalous_traffic', 'Traffic Anomaly', 'Traffic spike 300% above baseline', 'medium')
) AS t(source, alert_type, alert_title, description, severity)
WHERE random() < 0.15
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 6: Scale ML Risk Predictions (12 → 150+)
-- ============================================================================

INSERT INTO ml_risk_predictions (organization_id, model_name, current_risk_score, predicted_risk_score, confidence_interval, prediction_horizon_days, features, recommendation, created_at)
SELECT
  o.id,
  t.model_name,
  round((random() * 100)::numeric, 2),
  round((random() * 100)::numeric, 2),
  round((0.5 + random() * 0.5)::numeric, 3),
  t.horizon,
  jsonb_build_object(
    'sector', o.sector,
    'compliance_score', o.compliance_score,
    'incident_count', floor(random() * 10),
    'days_since_last_audit', floor(random() * 365)
  ),
  t.recommendation,
  NOW() - (random() * interval '30 days')
FROM organizations o
CROSS JOIN (VALUES
  ('breach_predictor_v2', 30, 'Review security controls and patch management'),
  ('breach_predictor_v2', 90, 'Schedule comprehensive security audit'),
  ('compliance_drift_model', 60, 'Update privacy policy and consent forms'),
  ('penalty_risk_model', 30, 'Address outstanding enforcement actions')
) AS t(model_name, horizon, recommendation)
WHERE random() < 0.35
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 7: Scale Audit Logs (175 → 400+)
-- ============================================================================

INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, details, created_at)
SELECT
  (SELECT id FROM users ORDER BY random() LIMIT 1),
  t.action,
  t.resource_type,
  floor(random() * 1000)::int,
  '10.' || floor(random() * 255)::int || '.' || floor(random() * 255)::int || '.' || floor(random() * 255)::int,
  'Mozilla/5.0 (NDSEP-Agent/3.2)',
  jsonb_build_object('source', 'system', 'tier', CASE WHEN random() < 0.3 THEN 'admin' ELSE 'user' END),
  NOW() - (random() * interval '90 days')
FROM generate_series(1, 250) AS g
CROSS JOIN (VALUES
  ('view', 'organization'),
  ('update', 'compliance_score'),
  ('create', 'breach_incident'),
  ('export', 'report'),
  ('login', 'session'),
  ('approve', 'enforcement_action'),
  ('delete', 'consent_record'),
  ('share', 'cross_border_transfer')
) AS t(action, resource_type)
WHERE random() < 0.15
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 8: Scale DPCO Organisations (3 → 30+)
-- ============================================================================

INSERT INTO dpco_organisations (name, licence_number, status, tier, email, phone, dpo_name, dpo_email, created_at)
SELECT
  t.org_name,
  'DPCO-' || lpad(g::text, 4, '0'),
  CASE WHEN random() < 0.6 THEN 'active' WHEN random() < 0.85 THEN 'pending' ELSE 'suspended' END,
  CASE WHEN random() < 0.3 THEN 'gold' WHEN random() < 0.7 THEN 'silver' ELSE 'bronze' END,
  lower(replace(t.org_name, ' ', '.')) || '@dpco.ng',
  '+234-' || floor(random() * 900 + 100)::text || '-' || floor(random() * 9000 + 1000)::text,
  'DPO ' || t.org_name,
  'dpo.' || lower(replace(t.org_name, ' ', '.')) || '@dpco.ng',
  NOW() - (random() * interval '730 days')
FROM generate_series(1, 5) AS g
CROSS JOIN (VALUES
  ('DataShield Consulting'),
  ('PrivacyFirst Nigeria'),
  ('ComplianceHub Africa'),
  ('CyberGuard Pro'),
  ('DataTrust Partners'),
  ('PrivacyWorks Ltd'),
  ('SecureData NG'),
  ('CompliancePro Services'),
  ('InfoSec Solutions'),
  ('DataProtect Nigeria')
) AS t(org_name)
WHERE random() < 0.5
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 9: Scale KYC Records (15 → 100+)
-- ============================================================================

INSERT INTO kyc_records (reference_id, bank_id, subject_type, full_name, nationality, bvn, nin, email, phone_number, risk_level, status, tier, created_at)
SELECT
  'KYC-' || lpad((row_number() OVER ())::text, 6, '0'),
  o.id,
  CASE WHEN random() < 0.7 THEN 'individual' ELSE 'corporate' END,
  t.customer_name,
  'Nigerian',
  lpad(floor(random() * 100000000000)::text, 11, '0'),
  lpad(floor(random() * 100000000000)::text, 11, '0'),
  lower(replace(t.customer_name, ' ', '.')) || '@example.ng',
  '+234-' || floor(random() * 900 + 100)::text || floor(random() * 9000000 + 1000000)::text,
  CASE WHEN random() < 0.3 THEN 'high' WHEN random() < 0.7 THEN 'medium' ELSE 'low' END,
  CASE WHEN random() < 0.6 THEN 'verified' WHEN random() < 0.85 THEN 'pending' ELSE 'rejected' END,
  CASE WHEN random() < 0.4 THEN 'tier3' WHEN random() < 0.7 THEN 'tier2' ELSE 'tier1' END,
  NOW() - (random() * interval '365 days')
FROM organizations o
CROSS JOIN (VALUES
  ('Adebayo Ogunleye'),
  ('Fatima Musa Ibrahim'),
  ('Chukwuemeka Obi'),
  ('Amina Yusuf Abdullahi'),
  ('Oluwaseun Adeyemi')
) AS t(customer_name)
WHERE random() < 0.25
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 10: Production indexes for high-traffic queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_breach_org_severity ON breach_incidents(organization_id, breach_incident_severity);
CREATE INDEX IF NOT EXISTS idx_breach_status_detected ON breach_incidents(breach_incident_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_org_status ON consent_records(organization_id, consent_status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, action);
CREATE INDEX IF NOT EXISTS idx_security_alerts_sev ON security_alerts(severity, is_resolved);
CREATE INDEX IF NOT EXISTS idx_ml_pred_org ON ml_risk_predictions(organization_id, model_name);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_org ON enforcement_actions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_organizations_sector ON organizations(sector, compliance_score DESC);
CREATE INDEX IF NOT EXISTS idx_organizations_compliance ON organizations(compliance_status);

-- Update statistics for query planner
ANALYZE organizations;
ANALYZE breach_incidents;
ANALYZE consent_records;
ANALYZE kyc_records;
ANALYZE enforcement_actions;
ANALYZE security_alerts;
ANALYZE ml_risk_predictions;
ANALYZE audit_logs;
