-- Nigerian NDSEP Demo Data Seed
-- Uses correct PostgreSQL schema column names

-- Truncate in dependency order
TRUNCATE TABLE streaming_events, audit_logs, ml_risk_predictions, financial_penalties,
  enforcement_actions, compliance_violations, security_alerts, network_events,
  threat_intelligence, data_catalog_entries, assets, compliance_policies,
  organizations RESTART IDENTITY CASCADE;

-- ── Nigerian Organizations ────────────────────────────────────────────────────
INSERT INTO organizations (name, registration_number, sector, country, city, latitude, longitude, compliance_score, compliance_status, agent_installed, agent_version, last_agent_heartbeat, declared_asset_count, discovered_asset_count, risk_score)
VALUES
  ('First Bank of Nigeria Plc',          'NITDA-FBN-2024-001',  'Financial Services',  'Nigeria', 'Lagos',  6.4541, 3.3947, 84.5, 'compliant',     true,  '2.1.4', NOW() - INTERVAL '2 minutes',  1450, 1467, 16.2),
  ('MTN Nigeria Communications Plc',     'NITDA-MTN-2024-002',  'Telecommunications',  'Nigeria', 'Lagos',  6.5244, 3.3792, 59.3, 'non_compliant', true,  '2.1.4', NOW() - INTERVAL '5 minutes',  3200, 3589, 74.4),
  ('Lagos University Teaching Hospital', 'NITDA-LUTH-2024-003', 'Healthcare',          'Nigeria', 'Lagos',  6.5158, 3.3624, 72.8, 'under_review',  true,  '2.0.9', NOW() - INTERVAL '12 minutes',  420,  418, 37.6),
  ('Federal Ministry of Education',      'NITDA-FME-2024-004',  'Government',          'Nigeria', 'Abuja',  9.0579, 7.4951, 91.2, 'compliant',     true,  '2.1.4', NOW() - INTERVAL '1 minute',   1890, 1892,  9.1),
  ('Nigerian National Petroleum Corp',   'NITDA-NNPC-2024-005', 'Energy',              'Nigeria', 'Abuja',  9.0765, 7.3986, 43.7, 'non_compliant', false, NULL,    NULL,                           870, 1012, 89.3),
  ('Jumia Technologies AG Nigeria',      'NITDA-JMI-2024-006',  'E-Commerce',          'Nigeria', 'Lagos',  6.4698, 3.5852, 66.9, 'under_review',  true,  '2.1.3', NOW() - INTERVAL '8 minutes',   530,  545, 50.7),
  ('AIICO Insurance Plc',                'NITDA-AIICO-2024-007','Insurance',           'Nigeria', 'Lagos',  6.4355, 3.4197, 77.3, 'compliant',     true,  '2.1.4', NOW() - INTERVAL '3 minutes',   280,  282, 22.1),
  ('Nigerian Ports Authority',           'NITDA-NPA-2024-008',  'Transportation',      'Nigeria', 'Lagos',  6.4474, 3.4003, 53.4, 'remediation',   true,  '2.0.8', NOW() - INTERVAL '15 minutes',  760,  801, 63.8),
  ('Zenith Bank Plc',                    'NITDA-ZBP-2024-009',  'Financial Services',  'Nigeria', 'Lagos',  6.4281, 3.4219, 88.1, 'compliant',     true,  '2.1.4', NOW() - INTERVAL '4 minutes',  2100, 2115, 12.4),
  ('Nigerian Communications Commission', 'NITDA-NCC-2024-010',  'Government',          'Nigeria', 'Abuja',  9.0417, 7.4791, 95.7, 'compliant',     true,  '2.1.4', NOW() - INTERVAL '1 minute',    340,  341,  5.2);

-- ── Assets ────────────────────────────────────────────────────────────────────
INSERT INTO assets (organization_id, name, asset_type, status, ip_address, hostname, operating_system, os_version, location, latitude, longitude, cloud_provider, cloud_region, data_classification, is_within_borders, vulnerability_count)
VALUES
  (1, 'Core Banking Server CBN-01',       'hardware',  'active',      '10.1.1.10',    'cbs-01.fbn.local',      'Ubuntu',          '22.04 LTS', 'Victoria Island Data Center', 6.4281, 3.4219, NULL,    NULL,          'tier2_financial', true,  2),
  (1, 'Customer Database Primary',        'database',  'active',      '10.1.1.20',    'db-primary.fbn.local',  'PostgreSQL',      '16.2',      'Victoria Island Data Center', 6.4281, 3.4219, NULL,    NULL,          'tier1_pii',       true,  0),
  (1, 'AWS S3 Customer Backups',          'cloud',     'active',      NULL,           NULL,                    NULL,              NULL,        'us-east-1',                  37.0902,-95.7129,'AWS',   'us-east-1',   'tier1_pii',       false, 1),
  (2, 'Subscriber Management System',     'software',  'active',      '192.168.10.5', 'sms.mtn.local',         'Windows Server',  '2022',      'Ikoyi NOC',                   6.4541, 3.3947, NULL,    NULL,          'tier1_pii',       true,  5),
  (2, 'Network Core Router Lagos IXP',    'network',   'active',      '172.16.0.1',   'core-rtr-01.mtn',       'Cisco IOS',       '17.6',      'IXPN Lagos',                  6.5244, 3.3792, NULL,    NULL,          'tier5_public',    true,  3),
  (2, 'Azure Blob Storage EU West',       'cloud',     'active',      NULL,           NULL,                    NULL,              NULL,        'westeurope',                 52.3667, 4.9000, 'Azure', 'westeurope',  'tier1_pii',       false, 0),
  (3, 'Patient Records Server LUTH',      'hardware',  'active',      '10.5.1.100',   'prs-01.luth.local',     'Red Hat Enterprise','9.3',     'LUTH Server Room',            6.5158, 3.3624, NULL,    NULL,          'tier3_health',    true,  1),
  (3, 'Medical Imaging PACS System',      'database',  'active',      '10.5.1.101',   'pacs.luth.local',       'PostgreSQL',      '15.4',      'LUTH Server Room',            6.5158, 3.3624, NULL,    NULL,          'tier3_health',    true,  0),
  (4, 'EMIS Student Information System',  'software',  'active',      '10.4.1.50',    'emis.fme.gov.ng',       'Ubuntu',          '22.04 LTS', 'Abuja Ministry HQ',           9.0579, 7.4951, NULL,    NULL,          'tier1_pii',       true,  0),
  (5, 'SCADA Pipeline Control System',    'hardware',  'quarantined', '172.20.1.1',   'scada-01.nnpc.local',   'Windows',         '10 IoT',    'Warri Refinery',              5.5167, 5.7500, NULL,    NULL,          'tier4_government',true, 12),
  (5, 'GCP Analytics Bucket EU',          'cloud',     'active',      NULL,           NULL,                    NULL,              NULL,        'europe-west1',               50.8503, 4.3517, 'GCP',   'europe-west1','tier2_financial',  false, 0),
  (6, 'Jumia E-Commerce Platform',        'software',  'active',      '10.6.1.10',    'ecom.jumia.local',      'Ubuntu',          '20.04 LTS', 'Lekki Cloud DC',              6.4698, 3.5852, NULL,    NULL,          'tier2_financial',  true, 4),
  (7, 'Policy Management Database',       'database',  'active',      '10.7.1.20',    'pmdb.aiico.local',      'PostgreSQL',      '16.1',      'Marina Insurance HQ',         6.4355, 3.4197, NULL,    NULL,          'tier2_financial',  true, 0),
  (8, 'Port Operations Tracking System',  'software',  'active',      '10.8.1.30',    'pots.npa.gov.ng',       'Ubuntu',          '22.04 LTS', 'Apapa Port Complex',          6.4474, 3.4003, NULL,    NULL,          'tier5_public',     true, 2),
  (9, 'Zenith Internet Banking Platform', 'software',  'active',      '10.9.1.10',    'ibank.zenithbank.com',  'Ubuntu',          '22.04 LTS', 'Zenith Data Center Lagos',    6.4281, 3.4219, NULL,    NULL,          'tier1_pii',        true, 0),
  (10,'NCC Licensing Management System',  'software',  'active',      '10.10.1.5',    'lms.ncc.gov.ng',        'Ubuntu',          '22.04 LTS', 'NCC HQ Abuja',                9.0417, 7.4791, NULL,    NULL,          'tier4_government', true, 0);

-- ── NDPR Compliance Policies ──────────────────────────────────────────────────
INSERT INTO compliance_policies (name, description, category, opa_rule, severity, is_active, weight)
VALUES
  ('NDPR Data Residency Requirement',
   'All PII data must be stored within Nigeria as per NDPR Section 2.6',
   'Data Residency',
   'package ndpr_data_residency
default allow = false
allow { input.asset.is_within_borders == true }',
   'critical', true, 2.0),

  ('NDPR Cross-Border Transfer Prohibition',
   'Tier 1-3 data cannot be transferred outside Nigeria without NITDA approval',
   'Data Transfer',
   'package ndpr_cross_border
default deny = false
deny { input.event.is_cross_border == true; not input.transfer.nitda_approved }',
   'critical', true, 2.0),

  ('NDSEP Agent Heartbeat Compliance',
   'Discovery agents must report within 30 minutes per NDSEP monitoring requirements',
   'Agent Management',
   'package agent_health
default compliant = false
compliant { time.now_ns() - input.last_heartbeat_ns < 1800000000000 }',
   'high', true, 1.5),

  ('Asset Declaration Accuracy NITDA',
   'Discovered assets must not exceed declared count by more than 10%',
   'Asset Inventory',
   'package asset_accuracy
default compliant = false
compliant { input.discovered_count <= input.declared_count * 1.1 }',
   'high', true, 1.5),

  ('Critical Vulnerability Remediation SLA',
   'Critical CVEs must be remediated within 72 hours per NDPR security requirements',
   'Security',
   'package vuln_sla
default compliant = true
compliant = false { input.vulnerability.severity == "critical"; input.vulnerability.age_hours > 72 }',
   'critical', true, 2.0),

  ('PII Encryption at Rest AES-256',
   'All PII data must be encrypted at rest using AES-256 per NDPR Section 2.4',
   'Data Security',
   'package pii_encryption
default compliant = false
compliant { input.asset.encryption_algorithm == "AES-256" }',
   'high', true, 1.5),

  ('NITDA Approved Cloud Provider Policy',
   'Only NITDA-approved cloud providers may be used for national data storage',
   'Cloud Governance',
   'package cloud_approval
approved := {"AWS-Lagos", "Azure-Nigeria"}
default compliant = false
compliant { input.asset.cloud_provider in approved }',
   'medium', true, 1.0),

  ('Audit Log Retention 7 Years',
   'Audit logs must be retained for minimum 7 years per NDPR compliance requirements',
   'Audit & Compliance',
   'package audit_retention
default compliant = false
compliant { input.retention_years >= 7 }',
   'medium', true, 1.0);

-- ── Compliance Violations ─────────────────────────────────────────────────────
INSERT INTO compliance_violations (organization_id, policy_id, asset_id, title, description, severity, status, enforcement_status, detected_at, penalty_amount)
VALUES
  (2, 1, 6,  'MTN Nigeria: PII Stored Outside Nigeria',
   'Azure Blob Storage in westeurope contains 78M subscriber PII records violating NDPR Section 2.6 data residency requirements',
   'critical', 'non_compliant', 'penalty_imposed', NOW() - INTERVAL '5 days', 50000000),

  (5, 1, 11, 'NNPC: Financial Data on Foreign Cloud',
   'GCP Analytics bucket in europe-west1 contains 2.3M financial transaction records in violation of NDPR',
   'critical', 'non_compliant', 'audit_scheduled', NOW() - INTERVAL '3 days', 35000000),

  (2, 3, NULL,'MTN Nigeria: Agent Heartbeat Timeout',
   'Discovery agent on 3 MTN servers has not reported heartbeat for over 2 hours',
   'high', 'non_compliant', 'notice_sent', NOW() - INTERVAL '1 day', NULL),

  (5, 4, NULL,'NNPC: Undeclared Assets Discovered',
   'NNPC has 142 more assets than declared to NITDA (1012 discovered vs 870 declared) — potential shadow IT',
   'high', 'non_compliant', 'audit_scheduled', NOW() - INTERVAL '7 days', 15000000),

  (5, 5, 10, 'NNPC: Critical SCADA Vulnerability Unpatched',
   'SCADA pipeline control system at Warri Refinery has 12 critical CVEs unpatched beyond 72-hour NDPR SLA',
   'critical', 'non_compliant', 'penalty_imposed', NOW() - INTERVAL '10 days', 100000000),

  (8, 3, NULL,'NPA: Agent Version Outdated',
   'Nigerian Ports Authority running NDSEP agent v2.0.8; minimum required version is v2.1.0',
   'medium', 'remediation', 'notice_sent', NOW() - INTERVAL '2 days', NULL),

  (6, 4, NULL,'Jumia: Minor Asset Discrepancy',
   'Jumia Technologies has 15 more assets than declared to NITDA (545 discovered vs 530 declared)',
   'low', 'under_review', 'pending', NOW() - INTERVAL '4 days', NULL),

  (3, 6, 7,  'LUTH: Patient Data Encryption Non-Compliant',
   'Patient records server at LUTH using AES-128 instead of required AES-256 per NDPR health data requirements',
   'high', 'under_review', 'audit_scheduled', NOW() - INTERVAL '6 days', 25000000);

-- ── Security Alerts ───────────────────────────────────────────────────────────
INSERT INTO security_alerts (organization_id, asset_id, source, alert_type, title, description, severity, is_resolved, threat_actor_id, mitre_technique, detected_at)
VALUES
  (2, 5,  'zeek',    'bgp_hijack',         'BGP Route Hijack Detected - AS37148',
   'Unauthorized BGP announcement for 197.255.0.0/16 (MTN Nigeria ASN) detected originating from AS37148',
   'critical', false, 'AS37148-UNKNOWN', 'T1584.005', NOW() - INTERVAL '3 hours'),

  (5, 10, 'suricata','data_exfiltration',  'Cross-Border Data Exfiltration Attempt',
   'Large data transfer (2.4GB) detected from NNPC Warri Refinery SCADA to IP 34.90.100.200 in Netherlands',
   'critical', false, 'APT-INDUSTRIAL-07', 'T1048', NOW() - INTERVAL '45 minutes'),

  (3, 7,  'wazuh',   'unauthorized_access','Unauthorized Access to LUTH Patient Records',
   'Multiple failed SSH login attempts on LUTH patient records server from external IP 41.58.123.45',
   'high', false, NULL, 'T1110.001', NOW() - INTERVAL '2 hours'),

  (1, 1,  'wazuh',   'anomaly',            'Suspicious API Activity - FBN Core Banking',
   'Unusual API call pattern detected on First Bank Nigeria core banking server — possible credential stuffing',
   'high', false, NULL, 'T1078', NOW() - INTERVAL '1 hour'),

  (6, 12, 'suricata','intrusion',          'SQL Injection Attempt on Jumia E-Commerce',
   'SQL injection pattern detected in Jumia e-commerce platform request logs from IP 41.203.78.12',
   'medium', true, NULL, 'T1190', NOW() - INTERVAL '3 hours'),

  (2, 4,  'wazuh',   'anomaly',            'MTN: TLS Certificate Expiry Warning',
   'MTN Subscriber Management System TLS certificate expires in 7 days — service disruption risk',
   'low', false, NULL, NULL, NOW() - INTERVAL '6 hours'),

  (10, 16,'suricata','intrusion',          'Port Scan Detected on NCC Systems',
   'Systematic port scan detected against NCC Licensing Management System from IP 196.46.12.89',
   'medium', false, NULL, 'T1046', NOW() - INTERVAL '4 hours'),

  (9, 15, 'wazuh',   'anomaly',            'Zenith Bank: Unusual Transaction Volume',
   'Transaction volume 340% above baseline on Zenith Internet Banking Platform — possible fraud or DDoS',
   'high', false, NULL, 'T1499', NOW() - INTERVAL '30 minutes');

-- ── Network Events ────────────────────────────────────────────────────────────
INSERT INTO network_events (organization_id, source_ip, destination_ip, source_country, destination_country, source_latitude, source_longitude, dest_latitude, dest_longitude, protocol, port, bytes_transferred, event_type, is_cross_border, ixp_site, suricata_rule_id, is_blocked, detected_at)
VALUES
  (2, '192.168.10.5', '20.50.80.100',  'Nigeria', 'Netherlands', 6.4541, 3.3947, 52.3667,  4.9000, 'HTTPS', 443, 2516582400, 'exfiltration_attempt', true,  'IXPN-Lagos',  'ET-POLICY-CLOUD-UPLOAD', false, NOW() - INTERVAL '45 minutes'),
  (5, '172.20.1.1',   '34.90.100.200', 'Nigeria', 'Belgium',     9.0765, 7.3986, 50.8503,  4.3517, 'HTTPS', 443, 1073741824, 'exfiltration_attempt', true,  'IXPN-Lagos',  'ET-POLICY-CLOUD-UPLOAD', false, NOW() - INTERVAL '40 minutes'),
  (1, '10.1.1.10',    '8.8.8.8',       'Nigeria', 'Nigeria',     6.4281, 3.4219,  9.0579,  7.4951, 'DNS',   53,  1024,       'normal',               false, 'IXPN-Lagos',  NULL,                     false, NOW() - INTERVAL '10 minutes'),
  (3, '41.58.123.45', '10.5.1.100',    'Nigeria', 'Nigeria',     6.5158, 3.3624,  6.5158,  3.3624, 'SSH',   22,  2048,       'exfiltration_attempt', false, 'IXPN-Lagos',  'ET-SCAN-SSH-BRUTE',      true,  NOW() - INTERVAL '2 hours'),
  (6, '41.203.78.12', '10.6.1.10',     'Nigeria', 'Nigeria',     6.4698, 3.5852,  6.4698,  3.5852, 'HTTPS', 443, 512,        'policy_violation',     false, 'IXPN-Lagos',  'ET-WEB-SQLI',            true,  NOW() - INTERVAL '3 hours'),
  (9, '10.9.1.10',    '196.201.216.1', 'Nigeria', 'Nigeria',     6.4281, 3.4219,  9.0417,  7.4791, 'HTTPS', 443, 524288,     'normal',               false, 'IXPN-Abuja',  NULL,                     false, NOW() - INTERVAL '5 minutes'),
  (2, '172.16.0.1',   '197.255.0.1',   'Nigeria', 'Nigeria',     6.5244, 3.3792,  6.5244,  3.3792, 'TCP',   179, 1024,       'anomaly',              false, 'IXPN-Lagos',  'BGP-HIJACK-DETECT',      false, NOW() - INTERVAL '3 hours'),
  (10,'196.46.12.89', '10.10.1.5',     'Nigeria', 'Nigeria',     9.0417, 7.4791,  9.0417,  7.4791, 'HTTP',  80,  4096,       'policy_violation',     false, 'IXPN-Abuja',  'ET-SCAN-NMAP',           true,  NOW() - INTERVAL '4 hours');

-- ── Financial Penalties ───────────────────────────────────────────────────────
INSERT INTO financial_penalties (organization_id, violation_id, amount, currency, payment_status, tiger_beetle_transfer_id, due_date, description)
VALUES
  (2, 1, 50000000,  'NGN', 'pending',    'TB-NITDA-2024-MTN-001',  NOW() + INTERVAL '26 days', 'NDPR Section 2.6: PII data stored outside Nigeria on Azure westeurope. First offence administrative penalty. Ref: NITDA-PEN-2024-MTN-001'),
  (5, 5, 100000000, 'NGN', 'overdue',    'TB-NITDA-2024-NNPC-001', NOW() - INTERVAL '9 days',  'NDPR critical vulnerability SLA breach on NNPC SCADA system. Critical infrastructure penalty. Ref: NITDA-PEN-2024-NNPC-001'),
  (5, 2, 35000000,  'NGN', 'pending',    'TB-NITDA-2024-NNPC-002', NOW() + INTERVAL '28 days', 'NDPR Section 2.6: Financial data on GCP europe-west1. Ref: NITDA-PEN-2024-NNPC-002'),
  (3, 8, 25000000,  'NGN', 'processing', 'TB-NITDA-2024-LUTH-001', NOW() + INTERVAL '25 days', 'NDPR health data encryption non-compliance at LUTH. AES-128 used instead of AES-256. Ref: NITDA-PEN-2024-LUTH-001'),
  (5, 4, 15000000,  'NGN', 'pending',    'TB-NITDA-2024-NNPC-003', NOW() + INTERVAL '24 days', 'NITDA asset declaration inaccuracy: 142 undeclared assets at NNPC. Ref: NITDA-PEN-2024-NNPC-003');

-- ── Threat Intelligence ───────────────────────────────────────────────────────
INSERT INTO threat_intelligence (source, indicator_type, indicator_value, threat_actor, campaign, mitre_tactic, mitre_technique, severity, confidence, is_active)
VALUES
  ('NITDA-CERT',      'ip',     '41.58.123.45',                   'UNKNOWN-TA-NG01', 'Operation HealthSweep',  'Credential Access',  'T1110.001', 'high',     0.85, true),
  ('NCC-CSIRT',       'ip',     '196.46.12.89',                   'UNKNOWN-TA-ZA01', 'AfriScan Campaign',      'Discovery',          'T1046',     'medium',   0.72, true),
  ('INTERPOL-AFRIPOL','domain', 'malware-c2.badactor.net',        'APT-FALCON',      'Operation Falcon',       'Command and Control','T1071.001', 'critical', 0.95, true),
  ('NITDA-CERT',      'ip',     '41.203.78.12',                   'UNKNOWN-TA-NG02', 'NigeriaEcomAttack',      'Initial Access',     'T1190',     'medium',   0.68, true),
  ('AFRIPOL',         'hash',   'a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6','CONTI-NG',      'LockBit Africa Energy',  'Impact',             'T1486',     'critical', 0.91, true);

-- ── Data Catalog Entries ──────────────────────────────────────────────────────
INSERT INTO data_catalog_entries (organization_id, name, description, data_type, classification, storage_location, is_within_borders, row_count, quality_score)
VALUES
  (1,  'FBN Customer PII Database',      'First Bank Nigeria customer personal data: BVN, NIN, account details, transaction history',   'structured', 'tier1_pii',       'Victoria Island DC - PostgreSQL Primary',  true,  4500000,  94.2),
  (2,  'MTN Subscriber Records',         'MTN Nigeria subscriber data: phone numbers, addresses, usage patterns, billing records',       'structured', 'tier1_pii',       'Ikoyi NOC - Subscriber Management System', true,  78000000, 87.5),
  (3,  'LUTH Patient Health Records',    'Lagos University Teaching Hospital patient medical records and diagnostic imaging data',        'structured', 'tier3_health',    'LUTH Server Room - Patient Records Server', true,  320000,   91.8),
  (4,  'FME Student Enrollment Data',    'Federal Ministry of Education national student enrollment and academic performance records',    'structured', 'tier1_pii',       'Abuja Ministry HQ - EMIS System',          true,  12500000, 89.3),
  (5,  'NNPC Pipeline Operations Data',  'NNPC pipeline monitoring, flow rates, pressure readings, and maintenance records',             'structured', 'tier4_government','Warri Refinery - SCADA Control System',    true,  850000,   76.4),
  (5,  'NNPC Financial Analytics EU',    'NNPC financial transaction analytics on GCP europe-west1 — NDPR violation active',             'structured', 'tier2_financial', 'GCP europe-west1 - Analytics Bucket',      false, 2300000,  82.1),
  (9,  'Zenith Bank Transaction Records','Zenith Bank Plc customer transaction history, account balances, and wire transfer records',    'structured', 'tier2_financial', 'Zenith Data Center Lagos - IB Platform',   true,  95000000, 96.7),
  (10, 'NCC Spectrum License Registry',  'Nigerian Communications Commission spectrum allocation, license registry, and renewal records','structured', 'tier4_government','NCC HQ Abuja - Licensing Management System',true, 45000,    99.1);

-- ── ML Risk Predictions ───────────────────────────────────────────────────────
INSERT INTO ml_risk_predictions (organization_id, model_name, current_risk_score, predicted_risk_score, confidence_interval, prediction_horizon_days, features, recommendation)
VALUES
  (2,  'ndsep-risk-v2.1', 74.4, 78.4, 0.89, 30, '{"cross_border_data":1,"agent_timeout":1,"undeclared_assets":0,"bgp_anomaly":1}', 'Immediate action required: resolve Azure westeurope data residency violation and investigate BGP anomaly'),
  (5,  'ndsep-risk-v2.1', 89.3, 91.2, 0.94, 30, '{"critical_vulnerabilities":12,"cross_border_data":1,"undeclared_assets":142,"scada_exposure":1}', 'Critical: patch SCADA CVEs within 72h, repatriate GCP data, declare all 1012 assets to NITDA'),
  (3,  'ndsep-risk-v2.1', 37.6, 42.6, 0.81, 30, '{"encryption_non_compliance":1,"unauthorized_access_attempt":3}', 'Upgrade patient records server encryption to AES-256 and implement IP allowlisting'),
  (1,  'ndsep-risk-v2.1', 16.2, 18.3, 0.92, 30, '{"api_anomaly":1,"cloud_backup_outside_borders":1}', 'Review API access logs and consider migrating S3 backups to AWS Lagos region'),
  (8,  'ndsep-risk-v2.1', 63.8, 65.7, 0.77, 30, '{"agent_version_outdated":1,"undeclared_assets":41}', 'Upgrade NDSEP agent to v2.1.4 and submit updated asset declaration to NITDA'),
  (9,  'ndsep-risk-v2.1', 12.4, 22.1, 0.88, 30, '{"transaction_volume_anomaly":1}', 'Investigate unusual transaction volume spike; verify no fraud or DDoS in progress'),
  (6,  'ndsep-risk-v2.1', 50.7, 51.4, 0.83, 30, '{"web_attack_detected":1,"minor_asset_discrepancy":15}', 'Deploy WAF rules for SQL injection protection and update NITDA asset declaration'),
  (10, 'ndsep-risk-v2.1',  5.2,  8.9, 0.95, 30, '{"port_scan_detected":1}', 'Block scanner IP 196.46.12.89 at perimeter firewall; no critical risk identified');

-- ── Audit Logs ────────────────────────────────────────────────────────────────
INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details, ip_address)
VALUES
  (NULL, 2,  'VIOLATION_DETECTED',  'compliance_violation', 1, 'NDPR violation detected: MTN Nigeria 78M subscriber PII records on Azure westeurope', '10.0.0.1'),
  (NULL, 5,  'PENALTY_ISSUED',      'financial_penalty',    2, 'NITDA administrative penalty issued to NNPC: NGN 100,000,000 for SCADA vulnerability SLA breach', '10.0.0.1'),
  (NULL, 2,  'BGP_HIJACK_DETECTED', 'security_alert',       1, 'BGP route hijack detected: AS37148 announcing MTN Nigeria prefix 197.255.0.0/16', '10.0.0.1'),
  (NULL, 3,  'AUDIT_SCHEDULED',     'organization',         3, 'NITDA compliance audit scheduled for Lagos University Teaching Hospital', '10.0.0.1'),
  (NULL, 1,  'ASSET_DISCOVERED',    'asset',                3, 'New cloud asset discovered: AWS S3 bucket (us-east-1) with tier1_pii classification outside Nigeria', '10.0.0.1'),
  (NULL, 8,  'NOTICE_ISSUED',       'enforcement_action',   4, 'NDSEP compliance notice issued to Nigerian Ports Authority for agent version non-compliance (v2.0.8)', '10.0.0.1'),
  (NULL, 6,  'SCORE_UPDATED',       'organization',         6, 'Compliance score updated from 63.2 to 66.9 after partial remediation by Jumia Technologies', '10.0.0.1'),
  (NULL, 5,  'VIOLATION_ESCALATED', 'compliance_violation', 5, 'NNPC SCADA vulnerability violation escalated to critical — NGN 100M penalty imposed by NITDA', '10.0.0.1'),
  (NULL, 9,  'ALERT_CREATED',       'security_alert',       8, 'Unusual transaction volume alert created for Zenith Bank Internet Banking Platform', '10.0.0.1'),
  (NULL, 10, 'SCAN_DETECTED',       'network_event',        8, 'Port scan from 196.46.12.89 detected and blocked at NCC perimeter firewall', '10.0.0.1');

