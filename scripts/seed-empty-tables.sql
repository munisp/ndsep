-- Seed script for all empty tables in NDSEP platform
-- Idempotent: skips if data already exists
-- Run: psql -f scripts/seed-empty-tables.sql

-- ========================================
-- 1. CROSS SECTOR DATA SHARES (new table)
-- ========================================
CREATE TABLE IF NOT EXISTS cross_sector_data_shares (
  id SERIAL PRIMARY KEY,
  share_id VARCHAR(50) UNIQUE NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  source_sector VARCHAR(100) NOT NULL,
  target_sector VARCHAR(100) NOT NULL,
  data_type VARCHAR(100) NOT NULL,
  justification TEXT,
  data_elements TEXT,
  requested_by INTEGER,
  requested_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO cross_sector_data_shares (share_id, organization_id, source_sector, target_sector, data_type, justification, data_elements, requested_by, requested_at, status)
SELECT * FROM (VALUES
  ('CSR-2026-001', 1, 'banking', 'telecom', 'compliance_data', 'Cross-sector risk assessment for shared customers', '["customer_risk_scores","compliance_status","aml_flags"]', 1, NOW() - INTERVAL '30 days', 'approved'),
  ('CSR-2026-002', 2, 'banking', 'telecom', 'compliance_data', 'KYC data harmonization for mobile banking users', '["kyc_verification","phone_linked_accounts"]', 1, NOW() - INTERVAL '25 days', 'approved'),
  ('CSR-2026-003', 3, 'banking', 'insurance', 'compliance_data', 'Insurance claim verification against banking records', '["transaction_history","account_status"]', 1, NOW() - INTERVAL '20 days', 'pending'),
  ('CSR-2026-004', 1, 'telecom', 'banking', 'compliance_data', 'Mobile money compliance data exchange', '["mobile_money_transactions","subscriber_kyc"]', 1, NOW() - INTERVAL '15 days', 'approved'),
  ('CSR-2026-005', 4, 'healthcare', 'insurance', 'compliance_data', 'Health data for insurance underwriting compliance', '["anonymized_health_records","treatment_codes"]', 1, NOW() - INTERVAL '10 days', 'rejected'),
  ('CSR-2026-006', 5, 'energy', 'banking', 'compliance_data', 'Energy consumption data for credit scoring', '["consumption_patterns","payment_history"]', 1, NOW() - INTERVAL '5 days', 'pending'),
  ('CSR-2026-007', 2, 'banking', 'telecom', 'compliance_data', 'Fraud detection data sharing for fintech oversight', '["fraud_flags","suspicious_transactions","device_fingerprints"]', 1, NOW() - INTERVAL '3 days', 'approved'),
  ('CSR-2026-008', 6, 'fintech', 'banking', 'compliance_data', 'Digital lending compliance data exchange', '["loan_performance","default_rates","borrower_profiles"]', 1, NOW() - INTERVAL '1 day', 'pending')
) AS v(share_id, organization_id, source_sector, target_sector, data_type, justification, data_elements, requested_by, requested_at, status)
WHERE NOT EXISTS (SELECT 1 FROM cross_sector_data_shares LIMIT 1);

-- ========================================
-- 2. ASSETS
-- ========================================
INSERT INTO assets (organization_id, name, asset_type, status, ip_address, hostname, operating_system, os_version, location, latitude, longitude, cloud_provider, data_classification, is_within_borders, vulnerability_count, discovered_at, last_seen, created_at)
SELECT * FROM (VALUES
  (1, 'Core Banking Server', 'hardware'::asset_type, 'active'::asset_status, '10.0.1.50', 'cbs-prod-01', 'Ubuntu', '22.04 LTS', 'Lagos DC', 6.5244, 3.3792, NULL, 'tier2_financial'::data_classification, true, 2, NOW() - INTERVAL '90 days', NOW(), NOW()),
  (1, 'Customer Data Warehouse', 'database'::asset_type, 'active'::asset_status, '10.0.2.100', 'cdw-prod', 'PostgreSQL', '15.4', 'Lagos DC', 6.5244, 3.3792, NULL, 'tier1_pii'::data_classification, true, 0, NOW() - INTERVAL '180 days', NOW(), NOW()),
  (2, 'MTN Mobile Money Platform', 'software'::asset_type, 'active'::asset_status, '10.1.1.10', 'momo-api', 'Linux', '5.15', 'Abuja DC', 9.0579, 7.4951, NULL, 'tier2_financial'::data_classification, true, 1, NOW() - INTERVAL '120 days', NOW(), NOW()),
  (3, 'AWS S3 Backup', 'cloud'::asset_type, 'active'::asset_status, NULL, NULL, NULL, NULL, 'eu-west-1', 53.3498, -6.2603, 'AWS', 'tier1_pii'::data_classification, false, 0, NOW() - INTERVAL '60 days', NOW(), NOW()),
  (4, 'Hospital Patient System', 'software'::asset_type, 'active'::asset_status, '192.168.5.20', 'hms-prod', 'Windows Server', '2022', 'Lagos General Hospital', 6.4541, 3.4082, NULL, 'tier3_health'::data_classification, true, 3, NOW() - INTERVAL '45 days', NOW(), NOW()),
  (5, 'NERC Grid Monitor', 'network'::asset_type, 'active'::asset_status, '10.5.1.1', 'grid-mon-01', 'Linux', '6.1', 'Abuja Grid Center', 9.0579, 7.4951, NULL, 'tier4_government'::data_classification, true, 1, NOW() - INTERVAL '30 days', NOW(), NOW()),
  (6, 'Paystack Payment Gateway', 'saas'::asset_type, 'active'::asset_status, NULL, 'api.paystack.co', NULL, NULL, 'Cloud', 6.5244, 3.3792, 'Azure', 'tier2_financial'::data_classification, false, 0, NOW() - INTERVAL '200 days', NOW(), NOW()),
  (1, 'NIN Verification Service', 'software'::asset_type, 'active'::asset_status, '10.0.3.55', 'nin-verify', 'Linux', '5.15', 'NIMC DC', 9.0579, 7.4951, NULL, 'tier1_pii'::data_classification, true, 1, NOW() - INTERVAL '15 days', NOW(), NOW()),
  (2, 'Firewall Edge Device', 'network'::asset_type, 'active'::asset_status, '10.1.0.1', 'fw-edge-01', 'FortiOS', '7.2', 'Lagos POP', 6.5244, 3.3792, NULL, 'tier5_public'::data_classification, true, 0, NOW() - INTERVAL '365 days', NOW(), NOW()),
  (7, 'NAICOM Claims Portal', 'software'::asset_type, 'inactive'::asset_status, '10.7.1.20', 'claims-portal', 'Linux', '5.15', 'Abuja HQ', 9.0579, 7.4951, NULL, 'tier2_financial'::data_classification, true, 5, NOW() - INTERVAL '10 days', NOW(), NOW())
) AS v(organization_id, name, asset_type, status, ip_address, hostname, operating_system, os_version, location, latitude, longitude, cloud_provider, data_classification, is_within_borders, vulnerability_count, discovered_at, last_seen, created_at)
WHERE NOT EXISTS (SELECT 1 FROM assets LIMIT 1);

-- ========================================
-- 3. AUDIT LOGS
-- ========================================
INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details, ip_address, created_at)
SELECT * FROM (VALUES
  (1, 1, 'LOGIN', 'user', 1, 'Admin login from Lagos office', '10.0.1.100', NOW() - INTERVAL '2 hours'),
  (1, 1, 'UPDATE_POLICY', 'compliance_policy', 3, 'Updated data retention policy to 7 years', '10.0.1.100', NOW() - INTERVAL '1 hour 45 min'),
  (2, 2, 'CREATE_DPIA', 'dpia', 5, 'Created DPIA for mobile money expansion', '10.1.1.55', NOW() - INTERVAL '1 hour 30 min'),
  (1, 1, 'EXPORT_DATA', 'report', 12, 'Exported quarterly compliance report', '10.0.1.100', NOW() - INTERVAL '1 hour'),
  (1, 3, 'APPROVE_TRANSFER', 'transfer', 8, 'Approved cross-border data transfer to UK partner', '10.0.1.100', NOW() - INTERVAL '45 min'),
  (2, 2, 'UPDATE_CONSENT', 'consent', 20, 'Updated consent records for 500 customers', '10.1.1.55', NOW() - INTERVAL '30 min'),
  (1, 1, 'RESOLVE_BREACH', 'breach', 3, 'Marked breach incident #BR-2026-003 as resolved', '10.0.1.100', NOW() - INTERVAL '20 min'),
  (1, 4, 'VERIFY_CERTIFICATE', 'certificate', 7, 'Verified NDPA compliance certificate for Lagos General Hospital', '10.0.1.100', NOW() - INTERVAL '15 min'),
  (2, 5, 'CREATE_ENFORCEMENT', 'enforcement', 2, 'Created enforcement case for data localization violation', '10.1.1.55', NOW() - INTERVAL '10 min'),
  (1, 1, 'RUN_SCAN', 'asset', NULL, 'Initiated full network asset discovery scan', '10.0.1.100', NOW() - INTERVAL '5 min'),
  (1, 6, 'UPDATE_KYC', 'kyc', 15, 'Updated KYC verification status for Paystack', '10.0.1.100', NOW() - INTERVAL '3 min'),
  (2, 2, 'SUBMIT_CAR', 'audit_return', 9, 'Submitted annual compliance audit return to NDPC', '10.1.1.55', NOW() - INTERVAL '1 min')
) AS v(user_id, organization_id, action, resource_type, resource_id, details, ip_address, created_at)
WHERE NOT EXISTS (SELECT 1 FROM audit_logs LIMIT 1);

-- ========================================
-- 4. COMPLIANCE POLICIES
-- ========================================
INSERT INTO compliance_policies (name, description, category, severity, is_active, weight, created_at, updated_at)
SELECT * FROM (VALUES
  ('Data Localization', 'Personal data of Nigerian citizens must be stored within Nigeria borders per NDPA Section 26', 'data_sovereignty', 'critical'::violation_severity, true, 1.0, NOW(), NOW()),
  ('Consent Collection', 'Valid consent must be obtained before processing personal data per NDPA Section 25', 'consent', 'high'::violation_severity, true, 0.9, NOW(), NOW()),
  ('Data Retention Limit', 'Personal data must not be retained beyond its stated purpose per NDPA Section 28', 'retention', 'high'::violation_severity, true, 0.85, NOW(), NOW()),
  ('DPO Appointment', 'Organizations processing significant personal data must appoint a Data Protection Officer', 'governance', 'medium'::violation_severity, true, 0.8, NOW(), NOW()),
  ('Breach Notification 72hr', 'Data breaches must be reported to NDPC within 72 hours of discovery', 'breach', 'critical'::violation_severity, true, 1.0, NOW(), NOW()),
  ('Cross-Border Transfer Adequacy', 'International data transfers require adequacy assessment or appropriate safeguards', 'transfer', 'high'::violation_severity, true, 0.9, NOW(), NOW()),
  ('Privacy Impact Assessment', 'DPIAs must be conducted for high-risk data processing activities', 'assessment', 'medium'::violation_severity, true, 0.75, NOW(), NOW()),
  ('Encryption at Rest', 'All personal data must be encrypted at rest using AES-256 or equivalent', 'security', 'high'::violation_severity, true, 0.85, NOW(), NOW()),
  ('Access Control', 'Role-based access control must be implemented for all personal data systems', 'security', 'medium'::violation_severity, true, 0.7, NOW(), NOW()),
  ('Audit Trail', 'All access and modifications to personal data must be logged and auditable', 'audit', 'medium'::violation_severity, true, 0.7, NOW(), NOW())
) AS v(name, description, category, severity, is_active, weight, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM compliance_policies LIMIT 1);

-- ========================================
-- 5. COMPLIANCE VIOLATIONS
-- ========================================
INSERT INTO compliance_violations (organization_id, policy_id, title, description, severity, status, enforcement_status, detected_at, penalty_amount, created_at)
SELECT * FROM (VALUES
  (3, 1, 'AWS S3 Bucket Outside Nigeria', 'Customer PII data stored in eu-west-1 region without adequacy assessment', 'critical'::violation_severity, 'open'::violation_status, 'warning_issued'::enforcement_status, NOW() - INTERVAL '15 days', 50000000.0, NOW()),
  (5, 5, 'Late Breach Notification', 'NERC data breach reported 96 hours after discovery, exceeding 72-hour window', 'high'::violation_severity, 'under_review'::violation_status, 'investigation'::enforcement_status, NOW() - INTERVAL '10 days', 25000000.0, NOW()),
  (7, 2, 'Missing Consent Records', 'Insurance claims processed without documented consent from data subjects', 'high'::violation_severity, 'open'::violation_status, 'notice_served'::enforcement_status, NOW() - INTERVAL '7 days', 10000000.0, NOW()),
  (4, 8, 'Unencrypted Patient Records', 'Hospital patient records stored in plaintext on network drive', 'critical'::violation_severity, 'resolved'::violation_status, 'penalty_imposed'::enforcement_status, NOW() - INTERVAL '45 days', 75000000.0, NOW()),
  (2, 3, 'Excessive Data Retention', 'Subscriber records retained for 10 years beyond contract termination', 'medium'::violation_severity, 'resolved'::violation_status, 'compliant'::enforcement_status, NOW() - INTERVAL '60 days', 5000000.0, NOW()),
  (6, 6, 'Unauthorized Transfer to US', 'Customer payment data transferred to US servers without SCC', 'high'::violation_severity, 'under_review'::violation_status, 'investigation'::enforcement_status, NOW() - INTERVAL '3 days', 30000000.0, NOW()),
  (1, 9, 'Insufficient Access Controls', 'Branch staff accessing customer records without role authorization', 'medium'::violation_severity, 'open'::violation_status, 'warning_issued'::enforcement_status, NOW() - INTERVAL '20 days', 8000000.0, NOW()),
  (8, 4, 'No DPO Appointed', 'Organization processing 500K+ records without registered DPO', 'medium'::violation_severity, 'resolved'::violation_status, 'compliant'::enforcement_status, NOW() - INTERVAL '90 days', 2000000.0, NOW())
) AS v(organization_id, policy_id, title, description, severity, status, enforcement_status, detected_at, penalty_amount, created_at)
WHERE NOT EXISTS (SELECT 1 FROM compliance_violations LIMIT 1);

-- ========================================
-- 6. DATA CATALOG ENTRIES
-- ========================================
INSERT INTO data_catalog_entries (organization_id, name, description, data_type, classification, quality_score, row_count, size_bytes, storage_location, is_within_borders, latitude, longitude, created_at, updated_at)
SELECT * FROM (VALUES
  (1, 'Customer KYC Records', 'Bank customer identity verification documents and data', 'structured', 'tier1_pii'::data_classification, 0.95, 2500000, 4800000000, 'Lagos DC - PostgreSQL Cluster', true, 6.5244, 3.3792, NOW(), NOW()),
  (1, 'Transaction Ledger', 'Daily banking transaction records for all accounts', 'structured', 'tier2_financial'::data_classification, 0.98, 15000000, 32000000000, 'Lagos DC - Oracle RAC', true, 6.5244, 3.3792, NOW(), NOW()),
  (2, 'Subscriber Profiles', 'Mobile network subscriber personal information', 'structured', 'tier1_pii'::data_classification, 0.88, 90000000, 120000000000, 'Abuja DC - MySQL', true, 9.0579, 7.4951, NOW(), NOW()),
  (3, 'Cloud Backup Archive', 'Encrypted customer data backups in AWS Ireland', 'unstructured', 'tier1_pii'::data_classification, 0.92, 500000, 850000000000, 'AWS eu-west-1 S3', false, 53.3498, -6.2603, NOW(), NOW()),
  (4, 'Patient Health Records', 'Electronic health records for hospital patients', 'structured', 'tier3_health'::data_classification, 0.85, 350000, 7500000000, 'Lagos General Hospital Server Room', true, 6.4541, 3.4082, NOW(), NOW()),
  (5, 'Grid Consumption Data', 'Electricity consumption data for residential and commercial customers', 'time_series', 'tier4_government'::data_classification, 0.91, 8000000, 15000000000, 'Abuja NERC DC', true, 9.0579, 7.4951, NOW(), NOW()),
  (6, 'Payment Transaction Logs', 'Fintech payment processing logs', 'structured', 'tier2_financial'::data_classification, 0.97, 50000000, 95000000000, 'Lagos Rack Center', true, 6.5244, 3.3792, NOW(), NOW()),
  (7, 'Insurance Claims Dataset', 'Historical insurance claims with policyholder PII', 'structured', 'tier2_financial'::data_classification, 0.82, 1200000, 2400000000, 'Abuja NAICOM DC', true, 9.0579, 7.4951, NOW(), NOW()),
  (1, 'ATM Location Data', 'GPS coordinates and usage statistics for ATM network', 'structured', 'tier5_public'::data_classification, 0.99, 12000, 24000000, 'Lagos DC', true, 6.5244, 3.3792, NOW(), NOW()),
  (2, 'Call Detail Records', 'Mobile network call metadata (anonymized)', 'structured', 'tier1_pii'::data_classification, 0.90, 500000000, 1200000000000, 'Abuja DC', true, 9.0579, 7.4951, NOW(), NOW())
) AS v(organization_id, name, description, data_type, classification, quality_score, row_count, size_bytes, storage_location, is_within_borders, latitude, longitude, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM data_catalog_entries LIMIT 1);

-- ========================================
-- 7. NETWORK EVENTS
-- ========================================
INSERT INTO network_events (organization_id, source_ip, destination_ip, source_country, destination_country, source_latitude, source_longitude, dest_latitude, dest_longitude, protocol, port, bytes_transferred, event_type, is_cross_border, ixp_site, is_blocked, detected_at, created_at)
SELECT * FROM (VALUES
  (1, '10.0.1.50', '196.1.1.100', 'NG', 'NG', 6.5244, 3.3792, 9.0579, 7.4951, 'HTTPS', 443, 5242880, 'transfer'::network_event_type, false, 'IXPN Lagos', false, NOW() - INTERVAL '2 hours', NOW()),
  (2, '10.1.1.10', '52.214.50.100', 'NG', 'IE', 6.5244, 3.3792, 53.3498, -6.2603, 'HTTPS', 443, 104857600, 'transfer'::network_event_type, true, NULL, false, NOW() - INTERVAL '1 hour 30 min', NOW()),
  (1, '41.58.100.50', '10.0.1.50', 'NG', 'NG', 9.0579, 7.4951, 6.5244, 3.3792, 'SSH', 22, 1024, 'intrusion_attempt'::network_event_type, false, 'IXPN Abuja', true, NOW() - INTERVAL '1 hour', NOW()),
  (3, '10.3.1.20', '54.239.28.85', 'NG', 'US', 6.5244, 3.3792, 37.7749, -122.4194, 'HTTPS', 443, 209715200, 'transfer'::network_event_type, true, NULL, false, NOW() - INTERVAL '45 min', NOW()),
  (4, '192.168.5.20', '192.168.5.21', 'NG', 'NG', 6.4541, 3.4082, 6.4541, 3.4082, 'TCP', 5432, 52428800, 'transfer'::network_event_type, false, NULL, false, NOW() - INTERVAL '30 min', NOW()),
  (5, '10.5.1.1', '10.5.2.50', 'NG', 'NG', 9.0579, 7.4951, 9.0579, 7.4951, 'SCADA', 502, 2048, 'anomaly'::network_event_type, false, NULL, false, NOW() - INTERVAL '20 min', NOW()),
  (2, '197.255.0.50', '10.1.1.10', 'GH', 'NG', 5.6037, -0.1870, 6.5244, 3.3792, 'DNS', 53, 512, 'dns_exfiltration'::network_event_type, true, 'GIX Accra', true, NOW() - INTERVAL '15 min', NOW()),
  (6, '10.6.1.100', '35.201.97.85', 'NG', 'US', 6.5244, 3.3792, 34.0522, -118.2437, 'HTTPS', 443, 1048576, 'transfer'::network_event_type, true, NULL, false, NOW() - INTERVAL '10 min', NOW()),
  (1, '10.0.1.50', '10.0.1.51', 'NG', 'NG', 6.5244, 3.3792, 6.5244, 3.3792, 'TCP', 5432, 524288000, 'transfer'::network_event_type, false, 'IXPN Lagos', false, NOW() - INTERVAL '5 min', NOW()),
  (7, '10.7.1.20', '13.107.42.14', 'NG', 'NL', 9.0579, 7.4951, 52.3676, 4.9041, 'HTTPS', 443, 10485760, 'transfer'::network_event_type, true, NULL, false, NOW() - INTERVAL '2 min', NOW())
) AS v(organization_id, source_ip, destination_ip, source_country, destination_country, source_latitude, source_longitude, dest_latitude, dest_longitude, protocol, port, bytes_transferred, event_type, is_cross_border, ixp_site, is_blocked, detected_at, created_at)
WHERE NOT EXISTS (SELECT 1 FROM network_events LIMIT 1);

-- ========================================
-- 8. SECURITY ALERTS
-- ========================================
INSERT INTO security_alerts (organization_id, source, alert_type, title, description, severity, is_resolved, threat_actor_id, mitre_technique, detected_at, created_at)
SELECT * FROM (VALUES
  (1, 'Wazuh SIEM', 'brute_force', 'SSH Brute Force on Core Banking Server', 'Multiple failed SSH login attempts from 41.58.100.50 targeting cbs-prod-01', 'high'::violation_severity, false, 'APT-NG-01', 'T1110.001', NOW() - INTERVAL '3 hours', NOW()),
  (2, 'Suricata IDS', 'data_exfiltration', 'DNS Tunneling Detected', 'Suspicious DNS queries from internal host encoding data to external resolver', 'critical'::violation_severity, false, NULL, 'T1048.001', NOW() - INTERVAL '2 hours', NOW()),
  (3, 'AWS GuardDuty', 'unauthorized_access', 'S3 Bucket Public Access Attempt', 'Attempt to make customer-data-backup bucket publicly accessible', 'high'::violation_severity, true, NULL, 'T1530', NOW() - INTERVAL '1 day', NOW()),
  (4, 'CrowdStrike', 'malware', 'Ransomware Indicator on HIS Server', 'File encryption activity detected on hospital information system', 'critical'::violation_severity, true, 'Conti-NG', 'T1486', NOW() - INTERVAL '5 days', NOW()),
  (5, 'Wazuh SIEM', 'privilege_escalation', 'Unauthorized Admin Access on Grid Monitor', 'Service account elevated to admin without change request', 'medium'::violation_severity, false, NULL, 'T1068', NOW() - INTERVAL '12 hours', NOW()),
  (6, 'Suricata IDS', 'lateral_movement', 'Internal Network Scanning Detected', 'Host performing port scans across fintech payment network segment', 'high'::violation_severity, false, NULL, 'T1046', NOW() - INTERVAL '6 hours', NOW()),
  (1, 'WAF', 'sql_injection', 'SQL Injection Attempt on API Gateway', 'OWASP rule triggered: SQLi pattern detected in /api/v1/customers endpoint', 'medium'::violation_severity, true, NULL, 'T1190', NOW() - INTERVAL '8 hours', NOW()),
  (2, 'Falcon', 'persistence', 'Suspicious Cron Job Created', 'New crontab entry added by non-admin user on subscriber-db server', 'medium'::violation_severity, false, NULL, 'T1053.003', NOW() - INTERVAL '4 hours', NOW())
) AS v(organization_id, source, alert_type, title, description, severity, is_resolved, threat_actor_id, mitre_technique, detected_at, created_at)
WHERE NOT EXISTS (SELECT 1 FROM security_alerts LIMIT 1);

-- ========================================
-- 9. THREAT INTELLIGENCE
-- ========================================
INSERT INTO threat_intelligence (source, indicator_type, indicator_value, threat_actor, campaign, mitre_tactic, mitre_technique, severity, confidence, is_active, first_seen, last_seen, created_at)
SELECT * FROM (VALUES
  ('CERT-NG', 'ip', '41.58.100.50', 'APT-NG-01', 'Operation Lagos Storm', 'Initial Access', 'T1190', 'high'::violation_severity, 0.92, true, NOW() - INTERVAL '30 days', NOW() - INTERVAL '3 hours', NOW()),
  ('OTX AlienVault', 'domain', 'data-exfil.ng-threat.com', NULL, NULL, 'Exfiltration', 'T1048', 'medium'::violation_severity, 0.78, true, NOW() - INTERVAL '15 days', NOW() - INTERVAL '2 hours', NOW()),
  ('MISP Nigeria', 'hash', 'a3f7c2d1e4b5f6a7c8d9e0f1a2b3c4d5', 'Conti-NG', 'Ransomware Wave 2026', 'Impact', 'T1486', 'critical'::violation_severity, 0.95, false, NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days', NOW()),
  ('VirusTotal', 'url', 'https://phishing-ng.example.com/login', NULL, 'Banking Phish Q1', 'Credential Access', 'T1566.002', 'high'::violation_severity, 0.88, true, NOW() - INTERVAL '7 days', NOW() - INTERVAL '1 day', NOW()),
  ('CERT-NG', 'ip', '197.255.0.50', NULL, NULL, 'Command and Control', 'T1071', 'medium'::violation_severity, 0.65, true, NOW() - INTERVAL '20 days', NOW() - INTERVAL '15 min', NOW()),
  ('Recorded Future', 'domain', 'c2-nigerian-apt.onion', 'APT-NG-02', 'Silent Kite', 'Command and Control', 'T1090', 'critical'::violation_severity, 0.90, true, NOW() - INTERVAL '45 days', NOW() - INTERVAL '12 hours', NOW()),
  ('Shodan', 'ip', '13.107.42.14', NULL, NULL, 'Reconnaissance', 'T1595', 'low'::violation_severity, 0.55, true, NOW() - INTERVAL '10 days', NOW() - INTERVAL '2 hours', NOW()),
  ('GreyNoise', 'ip', '185.220.101.50', NULL, 'Mass Scanning', 'Reconnaissance', 'T1046', 'low'::violation_severity, 0.70, true, NOW() - INTERVAL '90 days', NOW() - INTERVAL '30 min', NOW())
) AS v(source, indicator_type, indicator_value, threat_actor, campaign, mitre_tactic, mitre_technique, severity, confidence, is_active, first_seen, last_seen, created_at)
WHERE NOT EXISTS (SELECT 1 FROM threat_intelligence LIMIT 1);

-- ========================================
-- 10. ML RISK PREDICTIONS
-- ========================================
INSERT INTO ml_risk_predictions (organization_id, model_name, current_risk_score, predicted_risk_score, confidence_interval, prediction_horizon_days, features, recommendation, created_at)
SELECT * FROM (VALUES
  (1, 'gradient_boost_v3', 0.32, 0.28, 0.05, 30, '{"data_volume":2500000,"breach_history":1,"dpo_appointed":true,"sector":"banking"}'::jsonb, 'Risk trending downward. Maintain current compliance posture.', NOW()),
  (2, 'gradient_boost_v3', 0.45, 0.52, 0.08, 30, '{"data_volume":90000000,"breach_history":0,"dpo_appointed":true,"sector":"telecom"}'::jsonb, 'Risk increasing due to data volume growth. Consider additional DPIAs.', NOW()),
  (3, 'gradient_boost_v3', 0.68, 0.75, 0.10, 30, '{"data_volume":500000,"breach_history":2,"dpo_appointed":false,"sector":"tech"}'::jsonb, 'HIGH RISK: Data stored outside Nigeria. Immediate remediation required.', NOW()),
  (4, 'gradient_boost_v3', 0.55, 0.50, 0.07, 30, '{"data_volume":350000,"breach_history":1,"dpo_appointed":true,"sector":"healthcare"}'::jsonb, 'Risk stable. Complete encryption upgrade to improve score.', NOW()),
  (5, 'gradient_boost_v3', 0.38, 0.35, 0.06, 30, '{"data_volume":8000000,"breach_history":0,"dpo_appointed":true,"sector":"energy"}'::jsonb, 'Low risk. Strong compliance posture for government sector.', NOW()),
  (6, 'gradient_boost_v3', 0.72, 0.78, 0.12, 30, '{"data_volume":50000000,"breach_history":3,"dpo_appointed":true,"sector":"fintech"}'::jsonb, 'HIGH RISK: Cross-border transfers without SCC. Urgent action needed.', NOW()),
  (7, 'gradient_boost_v3', 0.48, 0.42, 0.06, 30, '{"data_volume":1200000,"breach_history":0,"dpo_appointed":true,"sector":"insurance"}'::jsonb, 'Risk decreasing. Recent policy updates having positive effect.', NOW()),
  (8, 'gradient_boost_v3', 0.25, 0.22, 0.04, 30, '{"data_volume":100000,"breach_history":0,"dpo_appointed":true,"sector":"government"}'::jsonb, 'Low risk. Model organization for compliance.', NOW())
) AS v(organization_id, model_name, current_risk_score, predicted_risk_score, confidence_interval, prediction_horizon_days, features, recommendation, created_at)
WHERE NOT EXISTS (SELECT 1 FROM ml_risk_predictions LIMIT 1);

-- ========================================
-- ALSO: Seed cross_sector_alerts if empty
-- ========================================
CREATE TABLE IF NOT EXISTS cross_sector_alerts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium',
  source_sector VARCHAR(100),
  target_sectors TEXT,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO cross_sector_alerts (title, severity, source_sector, target_sectors, description, status, created_at)
SELECT * FROM (VALUES
  ('Banking-Telecom Data Breach Spillover', 'critical', 'banking', 'telecom,fintech', 'Customer data from banking breach found on telecom dark web forums', 'active', NOW() - INTERVAL '2 days'),
  ('Healthcare PII Exposure via Insurance', 'high', 'healthcare', 'insurance', 'Patient records exposed through insurance claim integration API', 'investigating', NOW() - INTERVAL '5 days'),
  ('Energy Sector Compliance Deadline', 'medium', 'energy', 'all', 'NERC mandates data localization compliance by Q3 2026', 'active', NOW() - INTERVAL '10 days'),
  ('Fintech Cross-Border Alert', 'high', 'fintech', 'banking', 'Unusual cross-border transaction patterns detected between fintech and Nigerian banks', 'resolved', NOW() - INTERVAL '15 days'),
  ('Telecom Subscriber Data Sharing Violation', 'critical', 'telecom', 'banking,insurance', 'Unauthorized subscriber data sharing detected without consent', 'active', NOW() - INTERVAL '1 day')
) AS v(title, severity, source_sector, target_sectors, description, status, created_at)
WHERE NOT EXISTS (SELECT 1 FROM cross_sector_alerts LIMIT 1);

-- Refresh stats
ANALYZE;
