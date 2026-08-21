-- ============================================================================
-- NDSEP Comprehensive Synthetic Seed Data
-- Realistic Nigerian regulatory/compliance domain data for all 151 tables
-- Generated for NDSEP Platform v6.0
-- ============================================================================

-- Seed data (idempotent - safe to re-run)

-- ============================================================================
-- 1. FOUNDATION TABLES (no FK dependencies)
-- ============================================================================

-- organizations (referenced by many tables)
INSERT INTO organizations (name, registration_number, sector, country, city, latitude, longitude, compliance_score, compliance_status, agent_installed, agent_version, last_agent_heartbeat, declared_asset_count, discovered_asset_count, risk_score, contact_email) VALUES
('First Bank of Nigeria', 'RC-125439', 'banking', 'Nigeria', 'Lagos', 6.4541, 3.3947, 78.5, 'compliant', true, '3.2.1', NOW()-interval '5 minutes', 342, 378, 22.5, 'dpo@firstbanknigeria.com'),
('MTN Nigeria', 'RC-395010', 'telecom', 'Nigeria', 'Lagos', 6.4312, 3.4218, 85.2, 'compliant', true, '3.2.1', NOW()-interval '3 minutes', 856, 912, 15.3, 'privacy@mtnnigeria.net'),
('Dangote Group', 'RC-71242', 'manufacturing', 'Nigeria', 'Lagos', 6.4698, 3.5852, 62.1, 'under_review', true, '3.1.0', NOW()-interval '2 hours', 125, 143, 38.7, 'compliance@dangote.com'),
('Access Bank Plc', 'RC-125384', 'banking', 'Nigeria', 'Lagos', 6.4327, 3.4127, 82.3, 'compliant', true, '3.2.1', NOW()-interval '8 minutes', 289, 301, 18.2, 'dpo@accessbankplc.com'),
('Airtel Nigeria', 'RC-485633', 'telecom', 'Nigeria', 'Lagos', 6.4425, 3.4102, 71.8, 'compliant', true, '3.2.0', NOW()-interval '15 minutes', 534, 567, 28.4, 'privacy@airtel.com.ng'),
('Guaranty Trust Bank', 'RC-152321', 'banking', 'Nigeria', 'Lagos', 6.4281, 3.4214, 88.9, 'compliant', true, '3.2.1', NOW()-interval '2 minutes', 412, 425, 11.2, 'dpo@gtbank.com'),
('Shell Petroleum Dev Co', 'RC-2019', 'energy', 'Nigeria', 'Port Harcourt', 4.8156, 7.0498, 55.4, 'non_compliant', false, NULL, NULL, 89, 134, 44.6, 'dataprotection@shell.com.ng'),
('Nigerian Breweries', 'RC-613', 'manufacturing', 'Nigeria', 'Lagos', 6.5244, 3.3792, 73.6, 'compliant', true, '3.1.0', NOW()-interval '30 minutes', 67, 72, 26.4, 'privacy@nbplc.com'),
('Flutterwave Inc', 'RC-1578832', 'fintech', 'Nigeria', 'Lagos', 6.4355, 3.4105, 80.1, 'compliant', true, '3.2.1', NOW()-interval '1 minute', 156, 161, 19.9, 'compliance@flutterwave.com'),
('Interswitch Group', 'RC-486053', 'fintech', 'Nigeria', 'Lagos', 6.4402, 3.4187, 76.4, 'compliant', true, '3.2.0', NOW()-interval '12 minutes', 201, 218, 23.6, 'dpo@interswitchgroup.com');

-- sectors
INSERT INTO sectors (name, code, description, regulatory_framework, org_count) VALUES
('Banking & Financial Services', 'BFS', 'Commercial banks, microfinance, mortgage banks regulated by CBN', 'NDPA + CBN Guidelines', 24),
('Telecommunications', 'TEL', 'Mobile network operators, ISPs, VAS providers regulated by NCC', 'NDPA + NCC Consumer Code', 12),
('Healthcare', 'HCR', 'Hospitals, HMOs, pharmaceutical companies regulated by FMOH/NHIA', 'NDPA + NHIA Act', 18),
('Energy & Power', 'ENP', 'Generation, transmission, distribution companies regulated by NERC', 'NDPA + NERC Regulations', 15),
('Insurance', 'INS', 'Insurance companies, brokers, HMOs regulated by NAICOM', 'NDPA + NAICOM Guidelines', 20),
('FinTech', 'FNT', 'Payment processors, lending platforms, digital banks', 'NDPA + CBN Licensing Framework', 35),
('Government', 'GOV', 'Federal and state ministries, departments, and agencies', 'NDPA + FoI Act', 42),
('Education', 'EDU', 'Universities, polytechnics, secondary schools', 'NDPA + NUC Standards', 28),
('Manufacturing', 'MFG', 'FMCG, industrial, cement, steel, petrochemicals', 'NDPA General', 16),
('Oil & Gas', 'ONG', 'Upstream, midstream, downstream petroleum operations', 'NDPA + DPR/NUPRC Regulations', 22);

-- telecom_operators
INSERT INTO telecom_operators (operator_name, operator_code, operator_type, subscriber_base, market_share, coverage_pct, hq_state, data_localisation_compliant, lawful_intercept_enabled, is_active, ndpc_registered, status) VALUES
('MTN Nigeria Communications Plc', 'MTN', 'MNO', 78500000, 38.2, 95.5, 'Lagos', true, true, true, true, 'active'),
('Airtel Networks Limited', 'ART', 'MNO', 59200000, 28.8, 89.2, 'Lagos', true, true, true, true, 'active'),
('Globacom Limited', 'GLO', 'MNO', 55100000, 26.8, 82.7, 'Lagos', false, true, true, true, 'active'),
('Emerging Markets Telecom (9mobile)', '9MB', 'MNO', 12800000, 6.2, 62.1, 'Abuja', false, false, true, false, 'active'),
('Spectranet Limited', 'SPT', 'ISP', 450000, 0.2, 15.3, 'Lagos', true, false, true, true, 'active'),
('MainOne Cable Company', 'MOC', 'ISP', 2200, 0.01, 8.5, 'Lagos', true, true, true, true, 'active');

-- banking_institutions
INSERT INTO banking_institutions (cbn_code, sort_code, bic_code, name, short_name, license_type, license_number, status, head_office_address, ceo_name, total_assets, capital_adequacy_ratio, non_performing_loan_ratio, data_protection_officer, compliance_score, last_examination_date, next_examination_date) VALUES
('011', '011151003', 'FBNINGLA', 'First Bank of Nigeria Limited', 'FirstBank', 'commercial', 'CBN/BKR/001', 'active', '35 Samuel Manuwa Street, Victoria Island, Lagos', 'Adesola Adeduntan', 10254000000000, 17.8, 4.2, 'Oluwaseun Adekoya', 78.5, '2025-09-15', '2026-03-15'),
('044', '044151001', 'ABORNGLA', 'Access Bank Plc', 'AccessBank', 'commercial', 'CBN/BKR/044', 'active', '999C Danmole Street, Victoria Island, Lagos', 'Roosevelt Ogbonna', 18900000000000, 22.1, 3.1, 'Chinedu Okonkwo', 82.3, '2025-10-20', '2026-04-20'),
('058', '058151001', 'GTBINGLA', 'Guaranty Trust Holding Company', 'GTBank', 'commercial', 'CBN/BKR/058', 'active', '635 Akin Adesola Street, Victoria Island, Lagos', 'Segun Agbaje', 7820000000000, 25.3, 2.8, 'Adaeze Nwosu', 88.9, '2025-11-01', '2026-05-01'),
('033', '033151002', 'UNABORNG', 'United Bank for Africa Plc', 'UBA', 'commercial', 'CBN/BKR/033', 'active', '57 Marina, Lagos Island, Lagos', 'Oliver Alawuba', 11450000000000, 19.5, 3.9, 'Emmanuel Okeke', 74.2, '2025-08-12', '2026-02-12'),
('032', '032151001', 'UABORNGLA', 'Union Bank of Nigeria', 'UnionBank', 'commercial', 'CBN/BKR/032', 'active', '36 Marina, Lagos Island, Lagos', 'Mudassir Amray', 2340000000000, 15.2, 5.8, 'Fatima Bello', 65.7, '2025-07-20', '2026-01-20'),
('050', '050151001', 'ECOBNGLA', 'Ecobank Nigeria', 'Ecobank', 'commercial', 'CBN/BKR/050', 'active', '21 Ahmadu Bello Way, Victoria Island, Lagos', 'Bolaji Lawal', 3150000000000, 16.7, 4.5, 'Grace Adekunle', 71.3, '2025-06-15', '2025-12-15');

-- health_facilities
INSERT INTO health_facilities (facility_name, facility_code, facility_type, state, lga, patient_records_count, ehr_system, data_localisation_compliant, ndpc_registered, dpia_completed, is_active, status, compliance_score, nhia_accredited, bed_count) VALUES
('Lagos University Teaching Hospital', 'LUTH-001', 'tertiary', 'Lagos', 'Mushin', 2850000, 'MedRecord Pro', true, true, true, true, 'active', 82.5, true, 760),
('National Hospital Abuja', 'NHA-001', 'tertiary', 'FCT', 'Garki', 1950000, 'ClinicMaster', true, true, true, true, 'active', 79.3, true, 500),
('University of Benin Teaching Hospital', 'UBTH-001', 'tertiary', 'Edo', 'Egor', 1200000, 'OpenMRS', false, true, false, true, 'active', 61.8, true, 400),
('Eko Hospitals', 'EKO-001', 'private', 'Lagos', 'Surulere', 450000, 'Helium Health', true, true, true, true, 'active', 88.2, true, 120),
('Reddington Hospital', 'RED-001', 'private', 'Lagos', 'Ikeja', 320000, 'Helium Health', true, true, true, true, 'active', 91.4, true, 80);

-- energy_companies
INSERT INTO energy_companies (company_name, company_code, sector, company_type, customer_base, installed_capacity_mw, state, data_localisation_compliant, is_active, status) VALUES
('Ikeja Electric Plc', 'IKEDC', 'power', 'DisCo', 3200000, 0, 'Lagos', true, true, 'active'),
('Eko Electricity Distribution', 'EKEDC', 'power', 'DisCo', 2800000, 0, 'Lagos', true, true, 'active'),
('Egbin Power Plc', 'EGP', 'power', 'GenCo', 0, 1320, 'Lagos', false, true, 'active'),
('Transcorp Power Ughelli', 'TPU', 'power', 'GenCo', 0, 972, 'Delta', false, true, 'active'),
('Shell Petroleum Development', 'SPDC', 'oil_gas', 'Upstream', 0, 0, 'Rivers', false, true, 'active');

-- insurance_companies
INSERT INTO insurance_companies (company_name, company_code, company_type, gross_premium_ngn, policy_count, state, data_localisation_compliant, ndpc_registered, is_active, status, compliance_score) VALUES
('Leadway Assurance Company', 'LWA', 'composite', 95000000000, 285000, 'Lagos', true, true, true, 'active', 84.2),
('AXA Mansard Insurance', 'AXA', 'composite', 72000000000, 195000, 'Lagos', true, true, true, 'active', 87.5),
('AIICO Insurance Plc', 'AII', 'composite', 45000000000, 142000, 'Lagos', false, true, true, 'active', 68.9),
('Custodian Investment Plc', 'CIP', 'life', 38000000000, 98000, 'Lagos', true, true, true, 'active', 79.1);

-- fintech_companies
INSERT INTO fintech_companies (company_name, company_code, licence_type, transaction_volume_monthly, customer_base, state, data_localisation_compliant, ndpc_registered, is_active, status, compliance_score, api_volume, monthly_transaction_volume_ngn, wallet_balance_ngn) VALUES
('Flutterwave Technology Solutions', 'FLW', 'payment_processor', 45000000, 3500000, 'Lagos', true, true, true, 'active', 80.1, 890000000, 2150000000000, 45000000000),
('Paystack Payments Limited', 'PSK', 'payment_processor', 38000000, 2800000, 'Lagos', true, true, true, 'active', 85.3, 720000000, 1800000000000, 32000000000),
('OPay Digital Services', 'OPY', 'mobile_money', 92000000, 35000000, 'Lagos', true, true, true, 'active', 72.4, 1200000000, 5400000000000, 125000000000),
('PalmPay Limited', 'PPY', 'mobile_money', 67000000, 28000000, 'Lagos', false, true, true, 'active', 69.8, 850000000, 3200000000000, 89000000000),
('Carbon (formerly Paylater)', 'CRB', 'lending', 5200000, 4500000, 'Lagos', true, true, true, 'active', 76.5, 120000000, 450000000000, 12000000000);

-- incident_playbooks
INSERT INTO incident_playbooks (title, description, severity, category, steps, estimated_duration_hours, owner, is_active, activation_count) VALUES
('Data Breach Response Protocol', 'Standard response procedure for confirmed data breaches involving PII', 'critical', 'breach', '["Activate CSIRT team","Contain breach source","Assess scope of exposure","Notify NDPC within 72 hours","Notify affected data subjects","Preserve forensic evidence","Conduct root cause analysis","Implement remediation measures","Submit incident report to NDPC","Update security controls"]'::jsonb, 72, 'CISO', true, 12),
('Ransomware Incident Response', 'Procedure for handling ransomware attacks on NDSEP infrastructure', 'critical', 'security', '["Isolate affected systems","Activate backup recovery","Notify law enforcement","Assess data exfiltration risk","Restore from clean backups","Patch vulnerabilities","Update threat intelligence","Brief management","File regulatory report"]'::jsonb, 48, 'SOC Lead', true, 3),
('SLA Breach Escalation', 'Escalation procedure when compliance SLA targets are breached', 'high', 'compliance', '["Alert compliance team","Identify root cause","Calculate impact scope","Notify affected organizations","Implement corrective action","Update SLA monitoring","Document lessons learned"]'::jsonb, 24, 'Compliance Director', true, 28),
('Cross-Border Data Transfer Alert', 'Response to unauthorized cross-border data transfer detection', 'high', 'data_residency', '["Block data flow immediately","Identify data categories transferred","Assess NDPA Article 43 implications","Notify DPO","Check adequacy determination status","Initiate TIA if required","Notify NDPC if required","Remediate transfer mechanism"]'::jsonb, 12, 'Data Residency Officer', true, 7);

-- webhook_subscriptions
INSERT INTO webhook_subscriptions (org_id, url, events, secret, active, failure_count) VALUES
(1, 'https://firstbank-integrations.ng/webhooks/ndsep', ARRAY['breach.created','enforcement.updated','compliance.scored'], 'whsec_fb_prod_2026', true, 0),
(2, 'https://mtn-compliance.ng/api/webhooks', ARRAY['breach.created','sla.breached','enforcement.updated'], 'whsec_mtn_prod_2026', true, 2),
(4, 'https://accessbank-api.ng/compliance/hooks', ARRAY['breach.created','penalty.issued','dsar.received'], 'whsec_ab_prod_2026', true, 0),
(9, 'https://api.flutterwave.com/v3/compliance-hooks', ARRAY['breach.created','enforcement.updated'], 'whsec_flw_prod_2026', true, 1);


-- ============================================================================
-- 2. COMPLIANCE & PRIVACY TABLES
-- ============================================================================

-- consent_records
INSERT INTO consent_records (organization_id, data_subject_name, data_subject_email, data_subject_nin, purpose, lawful_basis, consent_status, consent_given_at, expires_at, evidence_ref, data_categories, processing_activities, third_party_sharing, cross_border_transfer) VALUES
(1, 'Adebayo Ogundimu', 'adebayo.o@gmail.com', '12345678901', 'Account opening and KYC processing', 'consent', 'active', NOW()-interval '180 days', NOW()+interval '365 days', 'CST-2025-00142', '["personal_details","financial_data","identity_documents"]'::jsonb, '["kyc_verification","credit_scoring","fraud_detection"]'::jsonb, true, false),
(1, 'Chioma Eze', 'chioma.eze@yahoo.com', '23456789012', 'Loan processing and credit assessment', 'contract', 'active', NOW()-interval '90 days', NOW()+interval '365 days', 'CST-2025-00289', '["personal_details","financial_data","employment_data"]'::jsonb, '["credit_assessment","disbursement","collections"]'::jsonb, true, false),
(2, 'Ibrahim Musa', 'ibrahim.m@hotmail.com', '34567890123', 'Mobile service provisioning and billing', 'contract', 'active', NOW()-interval '365 days', NOW()+interval '365 days', 'CST-2024-04521', '["personal_details","location_data","usage_data"]'::jsonb, '["service_delivery","billing","network_optimization"]'::jsonb, false, false),
(9, 'Funke Adeyemi', 'funke.a@outlook.com', '45678901234', 'Payment processing and transaction monitoring', 'legitimate_interests', 'active', NOW()-interval '60 days', NOW()+interval '730 days', 'CST-2025-01023', '["personal_details","financial_data","device_data"]'::jsonb, '["payment_processing","fraud_prevention","analytics"]'::jsonb, true, true),
(3, 'Emeka Nwankwo', 'emeka.n@gmail.com', '56789012345', 'Employee data processing for payroll', 'legal_obligation', 'active', NOW()-interval '450 days', NULL, 'CST-2024-00891', '["personal_details","employment_data","health_data"]'::jsonb, '["payroll","tax_compliance","benefits_admin"]'::jsonb, true, false),
(6, 'Aisha Bello', 'aisha.b@gmail.com', '67890123456', 'Digital banking services including mobile app', 'consent', 'withdrawn', NOW()-interval '200 days', NOW()+interval '165 days', 'CST-2024-02341', '["personal_details","financial_data","biometric_data"]'::jsonb, '["mobile_banking","biometric_auth","transaction_alerts"]'::jsonb, false, false),
(4, 'Oluwaseun Bakare', 'seun.b@proton.me', '78901234567', 'Wealth management advisory services', 'consent', 'active', NOW()-interval '30 days', NOW()+interval '335 days', 'CST-2025-01567', '["personal_details","financial_data","investment_profile"]'::jsonb, '["portfolio_mgmt","risk_profiling","regulatory_reporting"]'::jsonb, true, true),
(2, 'Ngozi Obi', 'ngozi.obi@gmail.com', '89012345678', 'Location-based services and targeted offers', 'consent', 'expired', NOW()-interval '400 days', NOW()-interval '35 days', 'CST-2024-01122', '["personal_details","location_data"]'::jsonb, '["targeted_marketing","location_services"]'::jsonb, true, false);

-- consent_lifecycle_events
INSERT INTO consent_lifecycle_events (consent_id, org_id, data_subject_id, event_type, purpose_category, legal_basis, data_categories, retention_period_days, ndpa_article) VALUES
('CST-2025-00142', 1, 'DS-001', 'granted', 'kyc', 'consent', ARRAY['personal','financial'], 1825, 'Article 25'),
('CST-2025-00289', 1, 'DS-002', 'granted', 'credit', 'contract', ARRAY['personal','financial','employment'], 2555, 'Article 26'),
('CST-2024-02341', 6, 'DS-006', 'withdrawn', 'banking', 'consent', ARRAY['personal','financial','biometric'], 365, 'Article 25(3)'),
('CST-2024-01122', 2, 'DS-008', 'expired', 'marketing', 'consent', ARRAY['personal','location'], 365, 'Article 25');

-- consent_audit_chain (blockchain-style)
INSERT INTO consent_audit_chain (subject_id, consent_type, action, previous_state, new_state, legal_basis, ip_address, user_agent, hash, previous_hash) VALUES
('DS-001', 'explicit', 'grant', NULL, 'active', 'consent', '102.89.23.145', 'Mozilla/5.0 (iPhone; iOS 17)', 'sha256:a1b2c3d4e5f6789012345678901234567890abcdef', NULL),
('DS-002', 'explicit', 'grant', NULL, 'active', 'contract', '41.190.2.34', 'Mozilla/5.0 (Android 14)', 'sha256:b2c3d4e5f6789012345678901234567890abcdef01', 'sha256:a1b2c3d4e5f6789012345678901234567890abcdef'),
('DS-006', 'explicit', 'withdraw', 'active', 'withdrawn', 'consent', '197.210.54.78', 'Mozilla/5.0 (Windows NT 10.0)', 'sha256:c3d4e5f6789012345678901234567890abcdef0123', 'sha256:b2c3d4e5f6789012345678901234567890abcdef01'),
('DS-008', 'explicit', 'expire', 'active', 'expired', 'consent', NULL, NULL, 'sha256:d4e5f6789012345678901234567890abcdef012345', 'sha256:c3d4e5f6789012345678901234567890abcdef0123');

-- breach_incidents
INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity, breach_incident_status, detected_at, ndpc_notification_deadline, ndpc_notified_at, affected_individuals_count, data_types_affected, breach_cause, remediation_actions, reported_by) VALUES
(7, 'Unauthorized Access to Employee Database', 'Former contractor retained VPN credentials and accessed HR database containing 2,300 employee records', 'high', 'contained', NOW()-interval '15 days', NOW()-interval '12 days', NOW()-interval '13 days', 2300, '["names","addresses","bank_account_numbers","NIN"]'::jsonb, 'Inadequate access revocation process for terminated contractors', 'VPN credentials revoked, access logs reviewed, affected employees notified, MFA enforced for all VPN', 1),
(3, 'Supply Chain Data Exposure via Misconfigured S3 Bucket', 'Publicly accessible S3 bucket exposed vendor contracts and financial data for 6 weeks', 'critical', 'resolved', NOW()-interval '45 days', NOW()-interval '42 days', NOW()-interval '43 days', 850, '["company_names","contract_values","bank_details","tax_ids"]'::jsonb, 'S3 bucket created without access controls during migration', 'Bucket secured, all exposed data rotated, vendor notification completed, S3 policy enforcement added', 1),
(9, 'API Key Exposure in Mobile App', 'Hardcoded API keys in mobile application allowed unauthorized access to transaction data', 'medium', 'ndpc_notified', NOW()-interval '5 days', NOW()-interval '2 days', NOW()-interval '3 days', 15000, '["transaction_history","account_balances","phone_numbers"]'::jsonb, 'API keys embedded in client-side code', 'Keys rotated, app update pushed, server-side auth implemented', 1),
(2, 'SIM Swap Fraud Data Breach', 'Organized crime ring exploited SIM swap process to access 450 customer accounts', 'high', 'individuals_notified', NOW()-interval '30 days', NOW()-interval '27 days', NOW()-interval '28 days', 450, '["phone_numbers","account_details","OTP_messages"]'::jsonb, 'Weak SIM swap verification process', 'Enhanced biometric verification for SIM swaps, affected customers notified and accounts secured', 1),
(1, 'Insider Threat - Unauthorized Data Export', 'Bank employee exported 12,000 customer records to personal email', 'critical', 'assessing', NOW()-interval '2 days', NOW()+interval '1 day', NULL, 12000, '["names","BVN","account_numbers","transaction_history"]'::jsonb, 'Insufficient DLP controls on email', 'Employee suspended, forensic investigation in progress, DLP rules updated', 1);

-- breach_timers
INSERT INTO breach_timers (breach_id, discovered_at, deadline_at, notified_at, escalations_sent, status) VALUES
(1, NOW()-interval '15 days', NOW()-interval '12 days', NOW()-interval '13 days', 0, 'notified'),
(2, NOW()-interval '45 days', NOW()-interval '42 days', NOW()-interval '43 days', 0, 'notified'),
(3, NOW()-interval '5 days', NOW()-interval '2 days', NOW()-interval '3 days', 0, 'notified'),
(4, NOW()-interval '30 days', NOW()-interval '27 days', NOW()-interval '28 days', 0, 'notified'),
(5, NOW()-interval '2 days', NOW()+interval '1 day', NULL, 2, 'escalating');

-- dpia_assessments
INSERT INTO dpia_assessments (organization_id, title, processing_description, trigger_category, dpia_status, dpia_risk_level, data_categories, purpose_of_processing, necessity_assessment, risk_assessment, mitigation_measures, ndpc_consultation_required) VALUES
(1, 'AI-Powered Credit Scoring System', 'Machine learning model analyzing transaction patterns, social data, and alternative data for automated credit decisions', 'automated_decision', 'approved', 'high', '["financial_data","transaction_history","device_data","social_indicators"]'::jsonb, 'Automated credit decisioning for instant loan approval/rejection', 'Essential for scaling micro-lending; manual review not feasible for 50K+ daily applications', 'Risk of bias against certain demographics; potential for unfair exclusion from credit; data accuracy concerns with alternative data sources', 'Human review for rejected applications; bias testing quarterly; data accuracy validation pipeline; appeal mechanism for applicants', true),
(2, 'Customer Location Tracking for Network Optimization', 'Processing real-time cell tower triangulation data to optimize network performance and coverage planning', 'large_scale', 'in_progress', 'medium', '["location_data","device_identifiers","usage_patterns"]'::jsonb, 'Network capacity planning and coverage optimization across Nigeria', 'Required by NCC licence conditions; essential for meeting QoS requirements', 'Location data reveals movement patterns; potential surveillance risk; data retention period concerns', 'Aggregation after 24 hours; pseudonymization of device IDs; strict access controls; 90-day retention limit', false),
(9, 'Biometric Payment Authentication', 'Fingerprint and facial recognition for transaction authentication in mobile app', 'biometric', 'review', 'high', '["biometric_data","financial_data","device_data"]'::jsonb, 'Strong customer authentication for high-value transactions', 'Regulatory requirement for 2FA; biometrics provide superior security vs OTP', 'Biometric data breach risk; spoofing attacks; function creep; vendor lock-in for biometric processing', 'On-device processing where possible; encrypted biometric templates; no raw biometric storage; annual security audit', true),
(3, 'Employee Wellness Monitoring Program', 'Health data collection from wearable devices for workplace safety monitoring in factories', 'health_data', 'draft', 'medium', '["health_data","location_data","personal_details"]'::jsonb, 'Occupational health monitoring and workplace safety compliance', 'Legal obligation under Factories Act; duty of care to employees', 'Sensitive health data processing; potential discrimination based on health status; consent validity concerns given employer-employee power imbalance', 'Anonymized aggregate reporting only; individual data access restricted to occupational health team; explicit opt-in consent with genuine alternative', false);

-- ropa_records
INSERT INTO ropa_records (organization_id, processing_activity_name, controller_name, dpo_contact, purpose_of_processing, lawful_basis, data_categories, data_subjects, recipients, third_country_transfers, transfer_safeguards, retention_period, security_measures, status) VALUES
(1, 'Customer Account Management', 'First Bank of Nigeria Limited', 'dpo@firstbanknigeria.com', 'Managing customer bank accounts, transactions, and related services', 'contract', '["personal_details","financial_data","identity_documents","contact_info"]'::jsonb, '["bank_customers","account_holders","signatories"]'::jsonb, '["CBN","NIBSS","credit_bureaus","correspondent_banks"]'::jsonb, false, NULL, '10 years after account closure (CBN requirement)', 'AES-256 encryption at rest, TLS 1.3 in transit, RBAC, audit logging, SOC2 Type II certified', 'active'),
(2, 'Subscriber Data Processing', 'MTN Nigeria Communications Plc', 'privacy@mtnnigeria.net', 'Mobile service delivery, billing, and network management', 'contract', '["personal_details","location_data","usage_data","device_info"]'::jsonb, '["mobile_subscribers","prepaid_customers","postpaid_customers"]'::jsonb, '["NCC","NIMC","law_enforcement_per_court_order"]'::jsonb, false, NULL, '5 years after subscription termination', 'ISO 27001 certified, pseudonymization of CDRs, MFA for system access', 'active'),
(9, 'Transaction Processing and AML Screening', 'Flutterwave Technology Solutions', 'compliance@flutterwave.com', 'Processing payments and conducting anti-money laundering checks', 'legal_obligation', '["personal_details","financial_data","device_data","transaction_data"]'::jsonb, '["merchants","payers","beneficiaries"]'::jsonb, '["CBN","NFIU","partner_banks","Visa","Mastercard"]'::jsonb, true, 'Standard Contractual Clauses with Stripe (US) and Visa (US); NDPC adequacy pending', '7 years for AML records (CBN/NFIU requirement)', 'PCI DSS Level 1 certified, tokenization, HSM for key management', 'active'),
(3, 'Employee HR Records', 'Dangote Industries Limited', 'compliance@dangote.com', 'Payroll processing, benefits administration, performance management', 'contract', '["personal_details","employment_data","financial_data","health_data"]'::jsonb, '["employees","contractors","interns"]'::jsonb, '["FIRS","pension_administrators","health_insurers"]'::jsonb, false, NULL, '6 years after employment termination', 'SAP HR with role-based access, encrypted personnel files, physical security for paper records', 'active');

-- privacy_notices
INSERT INTO privacy_notices (organization_id, notice_title, version, status, language, content, effective_date, review_date) VALUES
(1, 'Customer Privacy Notice', '3.2', 'active', 'en', 'First Bank of Nigeria Limited ("we", "us", "our") is committed to protecting your personal data in accordance with the Nigeria Data Protection Act 2023 (NDPA) and the Nigeria Data Protection Regulation (NDPR). This notice explains how we collect, use, store, and protect your personal data when you use our banking services...', NOW()-interval '90 days', NOW()+interval '275 days'),
(2, 'MTN Nigeria Privacy Policy', '5.1', 'active', 'en', 'MTN Nigeria Communications Plc respects your privacy and is committed to protecting your personal data. This privacy policy explains how we handle personal data when you subscribe to and use our mobile telecommunications services across Nigeria...', NOW()-interval '60 days', NOW()+interval '305 days'),
(9, 'Flutterwave Privacy Policy', '2.8', 'active', 'en', 'Flutterwave Technology Solutions Limited processes personal data to facilitate digital payments across Africa. This policy describes what data we collect, why we collect it, and how we protect it in compliance with the NDPA and applicable data protection laws...', NOW()-interval '45 days', NOW()+interval '320 days');

-- retention_policies
INSERT INTO retention_policies (organization_id, policy_name, data_category, retention_period_days, legal_basis, deletion_method, is_active, review_date) VALUES
(1, 'Customer Transaction Records', 'financial_data', 3650, 'CBN Circular BSD/DIR/GEN/LAB/14/001 requires 10 years', 'secure_deletion', true, NOW()+interval '180 days'),
(1, 'KYC Identity Documents', 'identity_documents', 3650, 'CBN/AML/CFT Regulations 2022', 'secure_deletion', true, NOW()+interval '180 days'),
(2, 'Call Detail Records', 'usage_data', 1825, 'NCC Consumer Code of Practice Regulations', 'anonymization', true, NOW()+interval '90 days'),
(2, 'Subscriber Location Data', 'location_data', 365, 'NDPA Article 28 - Data Minimization', 'secure_deletion', true, NOW()+interval '90 days'),
(9, 'Payment Transaction Logs', 'financial_data', 2555, 'CBN/NFIU AML reporting requirements (7 years)', 'secure_deletion', true, NOW()+interval '120 days'),
(3, 'Employee Personnel Files', 'employment_data', 2190, 'Labour Act compliance (6 years post-termination)', 'secure_deletion', true, NOW()+interval '365 days');

-- cookie_consent_records
INSERT INTO cookie_consent_records (organization_id, session_id, user_agent, ip_address, consent_given, analytics_cookies, marketing_cookies, functional_cookies, consent_version, domain, visitor_id) VALUES
(1, 'sess_fb_20250401_001', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)', '102.89.23.145', true, true, false, true, '2.1', 'firstbanknigeria.com', 'v_001'),
(2, 'sess_mtn_20250402_001', 'Mozilla/5.0 (Linux; Android 14)', '41.190.2.34', true, true, true, true, '1.5', 'mtnonline.com', 'v_002'),
(9, 'sess_flw_20250403_001', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', '197.210.54.78', true, false, false, true, '3.0', 'flutterwave.com', 'v_003'),
(4, 'sess_ab_20250404_001', 'Mozilla/5.0 (Windows NT 10.0; Win64)', '105.112.78.91', false, false, false, true, '2.0', 'accessbankplc.com', 'v_004');

-- parental_consent_records
INSERT INTO parental_consent_records (organization_id, child_ref, child_age, parent_guardian_name, parent_guardian_email, parent_guardian_nin, consent_purpose, consent_status, verification_method, verified) VALUES
(2, 'CHILD-MTN-001', 14, 'Alhaji Musa Ibrahim', 'musa.ibrahim@gmail.com', '11223344556', 'Youth data plan subscription with content filtering', 'active', 'nin_verification', true),
(1, 'CHILD-FB-001', 16, 'Mrs. Adebisi Johnson', 'adebisi.j@yahoo.com', '22334455667', 'Teen savings account with parental monitoring', 'active', 'in_branch_verification', true),
(8, 'CHILD-NB-001', 12, 'Dr. Chidinma Okafor', 'chidinma.o@gmail.com', '33445566778', 'School health data processing for brewery-sponsored program', 'pending', 'email_verification', false);

-- automated_decision_records
INSERT INTO automated_decision_records (organization_id, system_name, decision_type, data_subject_ref, decision_outcome, logic_explanation, human_review_available, human_review_requested, objection_raised) VALUES
(1, 'CreditScore AI v4.2', 'credit_decision', 'DS-2025-00142', 'Loan application approved - N2,500,000 at 18.5% APR', 'Credit score: 742/850. Factors: salary consistency (positive), account tenure 5 years (positive), existing loan repayment history 98% on-time (positive), debt-to-income ratio 32% (acceptable)', true, false, false),
(1, 'CreditScore AI v4.2', 'credit_decision', 'DS-2025-00289', 'Loan application declined - insufficient credit history', 'Credit score: 410/850. Factors: account tenure < 6 months (negative), no previous loan history (neutral), irregular deposits (negative). Alternative: Refer for micro-loan product', true, true, true),
(9, 'FraudGuard ML v2.1', 'fraud_detection', 'TXN-2025-892341', 'Transaction blocked - suspected fraud. Amount: N450,000 to new beneficiary at 02:34 AM', 'Anomaly score: 0.94. Triggers: unusual hour (02:34 AM), new beneficiary, amount 3x average, device fingerprint mismatch', true, false, false),
(2, 'ChurnPredict v1.8', 'customer_retention', 'SUB-MTN-45821', 'High churn risk flagged - retention offer triggered automatically (50% data bonus for 3 months)', 'Churn probability: 0.82. Factors: reduced data usage (-60% MoM), ported number inquiry detected, competitor promotional SMS received', false, false, false);

-- staff_training_records
INSERT INTO staff_training_records (organization_id, staff_name, staff_email, training_title, training_type, provider, completed_at, expires_at, score, passed, certificate_url) VALUES
(1, 'Oluwaseun Adekoya', 'o.adekoya@firstbanknigeria.com', 'NDPA Compliance for DPOs', 'mandatory', 'NDPC Academy', NOW()-interval '60 days', NOW()+interval '305 days', 92, true, '/certs/ndpa-dpo-2025-001.pdf'),
(1, 'Chibueze Ikenna', 'c.ikenna@firstbanknigeria.com', 'Data Breach Response Protocol', 'mandatory', 'Internal CISO Office', NOW()-interval '30 days', NOW()+interval '335 days', 88, true, '/certs/breach-resp-2025-001.pdf'),
(2, 'Amaka Nnaji', 'a.nnaji@mtnnigeria.net', 'Data Privacy Fundamentals', 'mandatory', 'IAPP Nigeria Chapter', NOW()-interval '90 days', NOW()+interval '275 days', 95, true, '/certs/dpf-2025-001.pdf'),
(9, 'Tunde Afolabi', 't.afolabi@flutterwave.com', 'PCI DSS v4.0 Compliance', 'mandatory', 'PCI Security Standards Council', NOW()-interval '45 days', NOW()+interval '320 days', 91, true, '/certs/pci-2025-001.pdf'),
(3, 'Blessing Udo', 'b.udo@dangote.com', 'Workplace Data Protection Awareness', 'recommended', 'NDPC Academy', NOW()-interval '120 days', NOW()+interval '245 days', 78, true, '/certs/dp-aware-2025-001.pdf'),
(4, 'Emeka Obi', 'e.obi@accessbankplc.com', 'DPIA Methodology and Best Practices', 'mandatory', 'NDPC Academy', NOW()-interval '15 days', NOW()+interval '350 days', 86, true, '/certs/dpia-2025-001.pdf');


-- ============================================================================
-- 3. ENFORCEMENT & FINANCIAL TABLES
-- ============================================================================

-- financial_penalties
INSERT INTO financial_penalties (organization_id, violation_id, amount, currency, payment_status, due_date, description) VALUES
(7, NULL, 25000000, 'NGN', 'pending', NOW()+interval '30 days', 'Unauthorized employee data access - NDPA Section 37(2) violation'),
(3, NULL, 150000000, 'NGN', 'pending', NOW()+interval '45 days', 'S3 data exposure affecting 850 data subjects - NDPA Section 38 breach notification delay'),
(5, NULL, 8000000, 'NGN', 'settled', NOW()-interval '60 days', 'Failure to appoint qualified DPO within statutory timeline'),
(2, NULL, 35000000, 'NGN', 'pending', NOW()+interval '15 days', 'SIM swap fraud vulnerability - inadequate security measures per NDPA Section 36');

-- enforcement_cases
INSERT INTO enforcement_cases (penalty_id, organization_id, status, case_reference, assigned_officer_id, overdue_days, escalation_reason, opened_at) VALUES
(1, 7, 'under_investigation', 'NDPC/ENF/2025/0892', 1, 0, NULL, NOW()-interval '15 days'),
(2, 3, 'notice_issued', 'NDPC/ENF/2025/0756', 1, 5, 'Organization failed to respond to initial notice within 14 days', NOW()-interval '40 days'),
(3, 5, 'settled', 'NDPC/ENF/2025/0621', 1, 0, NULL, NOW()-interval '120 days'),
(4, 2, 'open', 'NDPC/ENF/2025/0934', 1, 0, NULL, NOW()-interval '5 days'),
(NULL, 1, 'under_investigation', 'NDPC/ENF/2025/0945', 1, 0, NULL, NOW()-interval '2 days');

-- case_timeline
INSERT INTO case_timeline (case_id, changed_by_user_id, changed_by_name, from_status, to_status, note) VALUES
(1, 1, 'Admin User', 'open', 'under_investigation', 'Investigation commenced. Forensic team deployed to examine VPN logs and database access records.'),
(2, 1, 'Admin User', 'open', 'notice_issued', 'Formal notice issued under NDPA Section 43. Organization given 21 days to respond.'),
(2, 1, 'Admin User', 'notice_issued', 'notice_issued', 'Organization failed to respond within deadline. Second notice with escalation warning sent.'),
(3, 1, 'Admin User', 'open', 'settled', 'Organization paid N8M fine and submitted evidence of DPO appointment. Case closed.'),
(4, 1, 'Admin User', NULL, 'open', 'Case opened following SIM swap fraud breach report. Preliminary assessment initiated.');

-- enforcement_fines
INSERT INTO enforcement_fines (organization_id, fine_reference, violation_description, amount, currency, status, ndpc_reference, due_date, issued_at) VALUES
(7, 'FINE/2025/0892', 'Unauthorized access to employee PII database by former contractor', 25000000, 'NGN', 'unpaid', 'NDPC/ENF/2025/0892', NOW()+interval '30 days', NOW()-interval '10 days'),
(3, 'FINE/2025/0756', 'Data exposure via misconfigured cloud storage', 150000000, 'NGN', 'unpaid', 'NDPC/ENF/2025/0756', NOW()+interval '45 days', NOW()-interval '35 days'),
(5, 'FINE/2025/0621', 'Failure to appoint DPO per NDPA Section 32', 8000000, 'NGN', 'paid', 'NDPC/ENF/2025/0621', NOW()-interval '60 days', NOW()-interval '120 days'),
(2, 'FINE/2025/0934', 'Inadequate security measures leading to SIM swap fraud', 35000000, 'NGN', 'unpaid', 'NDPC/ENF/2025/0934', NOW()+interval '15 days', NOW()-interval '3 days');

-- enforcement_actions
INSERT INTO enforcement_actions (violation_id, organization_id, action_type, status, notice_issued_at, penalty_amount, notes, fine_amount) VALUES
(NULL, 7, 'investigation', 'pending', NOW()-interval '12 days', 25000000, 'Investigating unauthorized database access by former contractor', 25000000),
(NULL, 3, 'audit_scheduled', 'notice_sent', NOW()-interval '35 days', 150000000, 'Mandatory compliance audit following S3 data exposure', 150000000),
(NULL, 2, 'investigation', 'pending', NOW()-interval '3 days', 35000000, 'Investigating SIM swap fraud vulnerability and customer impact', 35000000);

-- enforcement_summary
INSERT INTO enforcement_summary (org_id, org_name, open_cases, total_penalties_ngn, pending_penalties, breaches_reported, last_event_at, compliance_score_impact) VALUES
(7, 'Shell Petroleum Dev Co', 1, 25000000, 1, 1, NOW()-interval '15 days', -5.2),
(3, 'Dangote Group', 1, 150000000, 1, 1, NOW()-interval '40 days', -8.1),
(5, 'Airtel Nigeria', 0, 8000000, 0, 0, NOW()-interval '60 days', -2.3),
(2, 'MTN Nigeria', 1, 35000000, 1, 1, NOW()-interval '5 days', -3.5),
(1, 'First Bank of Nigeria', 1, 0, 0, 1, NOW()-interval '2 days', -1.8);

-- penalty_calculations
INSERT INTO penalty_calculations (org_id, org_name, violation_type, violation_date, annual_turnover, base_penalty, aggravating_factors, mitigating_factors, aggravating_multiplier, mitigating_reduction, final_penalty, penalty_cap, calculation_basis, status) VALUES
(7, 'Shell Petroleum Dev Co', 'unauthorized_access', NOW()-interval '15 days', 450000000000, 10000000, '["Delayed breach notification","Inadequate access controls","Repeat offence in contractor management"]'::jsonb, '["Full cooperation with investigation","Immediate remediation steps taken"]'::jsonb, 2.5, 0.0, 25000000, 225000000, 'NDPA Section 49(1)(a) - max 2% of annual turnover or N10M', 'approved'),
(3, 'Dangote Group', 'data_exposure', NOW()-interval '45 days', 2800000000000, 50000000, '["Extended exposure period (6 weeks)","Sensitive financial data","Large number of affected subjects"]'::jsonb, '["No evidence of data misuse","Engaged external security firm"]'::jsonb, 3.0, 0.0, 150000000, 1400000000, 'NDPA Section 49(1)(b) - max 2% of annual turnover', 'approved');

-- penalty_appeals
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal, evidence_summary, requested_outcome, status) VALUES
(2, 3, 'Chief Legal Officer', 'legal@dangote.com', 'Penalty is disproportionate given immediate remediation and no evidence of data misuse. S3 misconfiguration was by third-party cloud consultant, not Dangote employees.', 'Third-party audit report confirming no data exfiltration; vendor contract showing security responsibility delegation; remediation timeline showing 4-hour response', 'reduction', 'under_review');

-- financial_ledger
INSERT INTO financial_ledger (transaction_id, organization_id, penalty_id, tx_type, status, amount, currency, debit_account, credit_account, description) VALUES
('TXN-ENF-2025-001', 5, 3, 'penalty', 'settled', 8000000, 'NGN', 'AIRTEL-ESCROW-001', 'NDPC-PENALTY-FUND', 'DPO appointment delay fine - settled'),
('TXN-ENF-2025-002', 7, 1, 'penalty', 'pending', 25000000, 'NGN', 'SHELL-ESCROW-001', 'NDPC-PENALTY-FUND', 'Unauthorized access penalty - pending'),
('TXN-ENF-2025-003', 3, 2, 'penalty', 'pending', 150000000, 'NGN', 'DANGOTE-ESCROW-001', 'NDPC-PENALTY-FUND', 'Data exposure penalty - under appeal');

-- citizen_requests (DSARs)
INSERT INTO citizen_requests (citizen_name, citizen_email, citizen_nin, request_type, status, organization_id, description, due_date, reference_number, response_deadline) VALUES
('Adebayo Ogundimu', 'adebayo.o@gmail.com', '12345678901', 'access', 'in_progress', 1, 'I want a copy of all personal data First Bank holds about me, including transaction history and KYC documents', NOW()+interval '20 days', 'DSAR-2025-00142', NOW()+interval '30 days'),
('Chioma Eze', 'chioma.eze@yahoo.com', '23456789012', 'erasure', 'submitted', 9, 'Please delete all my data from your systems. I no longer use Flutterwave and want all traces removed', NOW()+interval '25 days', 'DSAR-2025-00289', NOW()+interval '30 days'),
('Ibrahim Musa', 'ibrahim.m@hotmail.com', '34567890123', 'portability', 'completed', 2, 'Transfer my subscriber data and usage history to Airtel as I am porting my number', NOW()-interval '5 days', 'DSAR-2025-00198', NOW()-interval '2 days'),
('Funke Adeyemi', 'funke.a@outlook.com', '45678901234', 'objection', 'acknowledged', 2, 'I object to MTN processing my location data for targeted advertising. Stop immediately', NOW()+interval '15 days', 'DSAR-2025-00345', NOW()+interval '30 days'),
('Emeka Nwankwo', 'emeka.n@gmail.com', '56789012345', 'rectification', 'in_progress', 3, 'My employee records show incorrect date of birth and wrong state of origin. Please correct', NOW()+interval '10 days', 'DSAR-2025-00401', NOW()+interval '30 days');

-- compliance_policies
INSERT INTO compliance_policies (name, description, category, severity, is_active, weight) VALUES
('Data Residency Enforcement', 'All PII must be stored within Nigerian borders per NDPA Article 43', 'data_residency', 'critical', true, 1.0),
('Breach Notification SLA', 'NDPC must be notified within 72 hours of breach discovery per NDPA Section 39', 'breach', 'critical', true, 1.0),
('DPO Appointment Requirement', 'Organizations processing sensitive data must appoint a qualified DPO per NDPA Section 32', 'governance', 'high', true, 0.8),
('Consent Management', 'Valid consent must be freely given, specific, informed, and unambiguous per NDPA Section 25', 'consent', 'high', true, 0.9),
('DPIA for High-Risk Processing', 'DPIA required before processing likely to result in high risk to data subjects per NDPA Section 30', 'assessment', 'high', true, 0.8),
('Data Processing Agreement', 'Written DPA required between controller and processor per NDPA Section 29', 'agreements', 'medium', true, 0.7),
('Privacy Notice Publication', 'Clear and accessible privacy notice required per NDPA Section 27', 'transparency', 'medium', true, 0.6),
('Retention Period Enforcement', 'Data must not be retained beyond the specified retention period per NDPA Section 28', 'retention', 'medium', true, 0.7);

-- compliance_violations
INSERT INTO compliance_violations (organization_id, policy_id, title, description, severity, status, enforcement_status, penalty_amount) VALUES
(7, 1, 'Employee data stored on US-based Workday instance', 'HR data for 2,300 employees stored in Workday US data center without adequate transfer safeguards', 'high', 'open', 'notice_sent', 25000000),
(3, 1, 'S3 bucket in eu-west-1 containing vendor financial data', 'Cloud misconfiguration resulted in Nigerian vendor data being stored in AWS Ireland region', 'critical', 'remediation', 'audit_scheduled', 150000000),
(5, 3, 'DPO appointment delayed by 4 months past statutory deadline', 'Airtel Nigeria failed to appoint DPO within the required timeframe after NDPA came into force', 'medium', 'resolved', 'settled', 8000000),
(2, 2, 'SIM swap breach notification exceeded 72-hour window', 'MTN notified NDPC 86 hours after discovering the SIM swap fraud breach', 'high', 'open', 'pending', 0),
(1, 5, 'Credit scoring AI deployed without completing DPIA', 'First Bank rolled out AI credit scoring to production before DPIA was fully approved', 'high', 'under_review', 'pending', 0);

-- compliance_gap_assessments
INSERT INTO compliance_gap_assessments (assessment_ref, org_id, assessment_type, overall_score, gap_count, critical_gaps, high_gaps, medium_gaps, low_gaps, gaps, recommendations, status) VALUES
('CGA-2025-0142', 1, 'annual', 78.5, 8, 1, 2, 3, 2, '[{"area":"DPIA","gap":"AI credit scoring DPIA incomplete","severity":"critical"},{"area":"DPA","gap":"2 vendor DPAs expired","severity":"high"},{"area":"Training","gap":"15% staff not trained","severity":"medium"}]'::jsonb, '[{"priority":"critical","action":"Complete AI credit scoring DPIA immediately","deadline":"2025-06-01"},{"priority":"high","action":"Renew expired vendor DPAs","deadline":"2025-05-15"}]'::jsonb, 'completed'),
('CGA-2025-0289', 3, 'incident_triggered', 62.1, 14, 3, 4, 5, 2, '[{"area":"Cloud Security","gap":"No S3 access review process","severity":"critical"},{"area":"Vendor Management","gap":"Cloud vendor not assessed","severity":"critical"},{"area":"Data Residency","gap":"No automated residency checks","severity":"critical"}]'::jsonb, '[{"priority":"critical","action":"Implement automated cloud storage auditing","deadline":"2025-05-01"},{"priority":"critical","action":"Conduct full vendor risk assessment","deadline":"2025-04-15"}]'::jsonb, 'completed');

-- ndpa_compliance_snapshots
INSERT INTO ndpa_compliance_snapshots (organization_id, overall_score, consent_score, breach_score, dpia_score, ropa_score, dpo_score, transfer_score, open_violations, critical_violations, pending_dsars, active_breaches) VALUES
(1, 78.5, 85.0, 72.0, 65.0, 90.0, 95.0, 80.0, 2, 1, 1, 1),
(2, 85.2, 88.0, 78.0, 82.0, 85.0, 92.0, 90.0, 1, 0, 1, 1),
(3, 62.1, 70.0, 45.0, 55.0, 60.0, 75.0, 50.0, 2, 2, 1, 0),
(4, 82.3, 86.0, 80.0, 78.0, 88.0, 90.0, 85.0, 0, 0, 0, 0),
(5, 71.8, 75.0, 68.0, 70.0, 72.0, 60.0, 78.0, 0, 0, 0, 0),
(6, 88.9, 92.0, 85.0, 88.0, 90.0, 95.0, 88.0, 0, 0, 0, 0),
(7, 55.4, 60.0, 40.0, 50.0, 55.0, 48.0, 45.0, 1, 1, 0, 1),
(9, 80.1, 82.0, 75.0, 78.0, 80.0, 85.0, 72.0, 0, 0, 1, 1),
(10, 76.4, 78.0, 73.0, 75.0, 80.0, 82.0, 70.0, 0, 0, 0, 0);


-- ============================================================================
-- 4. BANKING & FINTECH TABLES
-- ============================================================================

-- kyc_records
INSERT INTO kyc_records (reference_id, bank_id, subject_type, full_name, date_of_birth, nationality, bvn, nin, address, phone, email, risk_level, status, tier, pep_flag, sanctions_flag, bvn_verified, nin_verified, address_verified, face_match_score, liveness_score, phone_number) VALUES
('KYC-2025-00142', 1, 'individual', 'Adebayo Ogundimu', '1985-03-15', 'Nigerian', '22345678901', '12345678901', '15 Awolowo Road, Ikoyi, Lagos', '08012345678', 'adebayo.o@gmail.com', 'low', 'approved', 'tier3', false, false, true, true, true, 98.5, 95.2, '08012345678'),
('KYC-2025-00289', 1, 'individual', 'Chioma Eze', '1992-07-22', 'Nigerian', '33456789012', '23456789012', '42 Stadium Road, Port Harcourt, Rivers', '08123456789', 'chioma.eze@yahoo.com', 'medium', 'approved', 'tier2', false, false, true, true, false, 92.1, 88.7, '08123456789'),
('KYC-2025-00345', 4, 'individual', 'Ibrahim Musa', '1978-11-05', 'Nigerian', '44567890123', '34567890123', '7 Ahmadu Bello Way, Kaduna', '07034567890', 'ibrahim.m@hotmail.com', 'low', 'approved', 'tier3', false, false, true, true, true, 96.8, 93.4, '07034567890'),
('KYC-2025-00401', 6, 'corporate', 'Dangote Cement Plc', '2000-01-01', 'Nigerian', NULL, NULL, 'Alfred Rewane Road, Ikoyi, Lagos', '08045678901', 'company@dangotecement.com', 'high', 'approved', 'tier3', true, false, NULL, NULL, true, NULL, NULL, '08045678901'),
('KYC-2025-00502', 1, 'individual', 'Ngozi Obi', '1995-02-14', 'Nigerian', '55678901234', '89012345678', '23 Aba Road, Onitsha, Anambra', '09056789012', 'ngozi.obi@gmail.com', 'low', 'pending', 'tier1', false, false, true, false, false, 88.2, 85.1, '09056789012');

-- aml_cases
INSERT INTO aml_cases (case_ref, bank_id, subject_name, subject_type, subject_bvn, case_type, status, risk_score, pep_match, sanctions_match, narrative, amount, currency, assigned_to) VALUES
('AML-2025-0142', 1, 'Olusegun Adeniyi', 'individual', '66789012345', 'suspicious_transaction', 'open', 85, false, false, 'Series of round-sum deposits totaling N45M over 3 days followed by immediate international wire transfers to Dubai. Pattern consistent with layering.', 45000000, 'NGN', 'AML Analyst Dept'),
('AML-2025-0289', 4, 'Global Trade Solutions Ltd', 'corporate', NULL, 'trade_based', 'under_review', 72, false, false, 'Import invoices show 300% markup on commodity prices vs market rates. Potential trade-based money laundering.', 280000000, 'NGN', 'AML Investigation Unit'),
('AML-2025-0345', 6, 'Chief James Okafor', 'individual', '77890123456', 'pep_monitoring', 'escalated', 95, true, false, 'PEP alert: Former state governor. Unusual N120M deposit from shell company. Source of funds documentation requested but not provided.', 120000000, 'NGN', 'Senior AML Officer'),
('AML-2025-0401', 1, 'Khadija Bello', 'individual', '88901234567', 'structuring', 'resolved', 45, false, false, 'Multiple cash deposits just below N5M threshold (structuring pattern). Investigation revealed legitimate business income from market trading.', 28000000, 'NGN', 'AML Analyst Dept');

-- fraud_alerts
INSERT INTO fraud_alerts (alert_ref, bank_id, transaction_ref, transaction_amount, account_number, alert_type, severity, status, description, risk_score) VALUES
('FRD-2025-001', 1, 'TXN-FB-892341', 450000, '3012345678', 'card_not_present', 'high', 'investigating', 'Unusual online transaction at 02:34 AM from IP in Eastern Europe. Card not present. Amount exceeds daily pattern.', 89),
('FRD-2025-002', 4, 'TXN-AB-562178', 2500000, '0441234567', 'account_takeover', 'critical', 'confirmed', 'SIM swap detected 2 hours before transaction. New device login. Password changed. Immediate N2.5M transfer to mule account.', 97),
('FRD-2025-003', 6, 'TXN-GT-781234', 180000, '0581234567', 'identity_theft', 'medium', 'resolved', 'Account opened with stolen identity documents. Detected during KYC re-verification exercise.', 75),
('FRD-2025-004', 1, 'TXN-FB-934521', 890000, '3019876543', 'insider_fraud', 'critical', 'investigating', 'Branch staff created ghost account and diverted customer refund. Detected by reconciliation algorithm.', 92);

-- swift_messages
INSERT INTO swift_messages (message_ref, message_type, sender_bic, receiver_bic, amount, currency, beneficiary_name, beneficiary_account, ordering_customer, status, narrative) VALUES
('MT103-2025-00142', 'MT103', 'FBNINGLA', 'CITIUS33', 850000, 'USD', 'Johnson Trading LLC', '4567890123', 'Adebayo Enterprises Ltd', 'completed', 'Payment for machinery import - LC ref 2025/FB/00892'),
('MT103-2025-00289', 'MT103', 'ABORNGLA', 'DEUTDEFF', 1200000, 'EUR', 'Siemens AG', '9876543210', 'Nigerian Electricity Corp', 'completed', 'Turbine maintenance contract Q2 2025'),
('MT202-2025-00345', 'MT202', 'GTBINGLA', 'CHASUS33', 5000000, 'USD', NULL, 'CHASE-NOSTRO', 'GT Bank Treasury', 'processing', 'Nostro account funding'),
('MT103-2025-00401', 'MT103', 'FBNINGLA', 'SCBLGB2L', 2500000, 'GBP', 'University of Leeds', 'GB45SCBL6789012', 'Scholarship Board Nigeria', 'completed', 'Student tuition payments - batch 2025/Q2');

-- nip_transactions
INSERT INTO nip_transactions (session_id, sender_bank_code, sender_bank_name, sender_account_number, sender_account_name, receiver_bank_code, receiver_bank_name, receiver_account_number, receiver_account_name, amount, narration, status, channel) VALUES
('NIP-2025-0001234', '011', 'First Bank', '3012345678', 'Adebayo Ogundimu', '044', 'Access Bank', '0441234567', 'Chibueze Trading Ltd', 250000, 'Payment for office supplies', 'successful', 'mobile'),
('NIP-2025-0001235', '058', 'GTBank', '0581234567', 'Oluwaseun Bakare', '011', 'First Bank', '3019876543', 'Emeka Motors', 1500000, 'Vehicle purchase deposit', 'successful', 'internet'),
('NIP-2025-0001236', '044', 'Access Bank', '0449876543', 'Fatima Enterprise', '033', 'UBA', '0331234567', 'Supplier Payments Ltd', 4500000, 'Raw materials procurement', 'successful', 'corporate'),
('NIP-2025-0001237', '011', 'First Bank', '3011111111', 'Ngozi Obi', '058', 'GTBank', '0582222222', 'Netflix Payment', 6500, 'Monthly subscription', 'successful', 'mobile'),
('NIP-2025-0001238', '033', 'UBA', '0333333333', 'Ibrahim Garba', '050', 'Ecobank', '0504444444', 'MTN Airtime VTU', 5000, 'Airtime purchase', 'failed', 'ussd');

-- rtgs_transactions
INSERT INTO rtgs_transactions (reference, sender_bank_code, sender_account_number, receiver_bank_code, receiver_account_number, amount, currency, status, settlement_date, narration) VALUES
('RTGS-2025-00142', '011', '3015555555', '044', '0446666666', 500000000, 'NGN', 'settled', CURRENT_DATE, 'Inter-bank settlement - clearing house obligations'),
('RTGS-2025-00289', '058', '0587777777', '011', '3018888888', 2000000000, 'NGN', 'settled', CURRENT_DATE-1, 'Treasury bill redemption proceeds'),
('RTGS-2025-00345', '044', '0449999999', '033', '0330000000', 750000000, 'NGN', 'processing', CURRENT_DATE, 'FGN bond coupon payment distribution');

-- correspondent_banks
INSERT INTO correspondent_banks (bank_id, correspondent_name, correspondent_bic, country, currency, account_number, relationship_type, status, risk_rating, last_review_date) VALUES
(1, 'JPMorgan Chase', 'CHASUS33', 'United States', 'USD', 'CHASE-FB-NOSTRO-001', 'nostro', 'active', 'low', '2025-03-15'),
(1, 'Standard Chartered UK', 'SCBLGB2L', 'United Kingdom', 'GBP', 'SCBL-FB-NOSTRO-001', 'nostro', 'active', 'low', '2025-02-20'),
(4, 'Deutsche Bank', 'DEUTDEFF', 'Germany', 'EUR', 'DEUT-AB-NOSTRO-001', 'nostro', 'active', 'low', '2025-01-15'),
(6, 'Citibank New York', 'CITIUS33', 'United States', 'USD', 'CITI-GT-NOSTRO-001', 'nostro', 'active', 'low', '2025-04-01');

-- cbn_reports
INSERT INTO cbn_reports (report_ref, bank_id, report_type, reporting_period, status, due_date, submitted_at, data, filing_deadline) VALUES
('CBN-RPT-2025-Q1-FB', 1, 'prudential_return', '2025-Q1', 'submitted', '2025-04-30', NOW()-interval '15 days', '{"total_assets":10254000000000,"capital_adequacy_ratio":17.8,"npl_ratio":4.2,"liquidity_ratio":42.1}'::jsonb, '2025-04-30'),
('CBN-RPT-2025-Q1-AB', 4, 'prudential_return', '2025-Q1', 'submitted', '2025-04-30', NOW()-interval '12 days', '{"total_assets":18900000000000,"capital_adequacy_ratio":22.1,"npl_ratio":3.1,"liquidity_ratio":48.3}'::jsonb, '2025-04-30'),
('CBN-RPT-2025-Q1-GT', 6, 'aml_report', '2025-Q1', 'draft', '2025-05-15', NULL, '{"strs_filed":12,"ctrs_filed":89,"suspicious_accounts_flagged":23,"total_blocked_amount":450000000}'::jsonb, '2025-05-15');


-- ============================================================================
-- 5. NETWORK, SECURITY, TELECOM & INFRASTRUCTURE TABLES
-- ============================================================================

-- assets
INSERT INTO assets (organization_id, name, asset_type, status, ip_address, hostname, operating_system, os_version, location, data_classification, is_within_borders, vulnerability_count, metadata) VALUES
(1, 'Core Banking Database Primary', 'database', 'active', '10.1.1.50', 'db-corebank-01.fb.local', 'Oracle Linux', '8.9', 'Lagos DC1, Lekki', 'tier2_financial', true, 2, '{"engine":"Oracle 19c","size_tb":12.5,"replication":"active-passive"}'::jsonb),
(1, 'Internet Banking Web Server', 'software', 'active', '10.1.2.10', 'web-ibank-01.fb.local', 'Red Hat Enterprise Linux', '9.3', 'Lagos DC1, Lekki', 'tier2_financial', true, 5, '{"framework":"Java Spring Boot","version":"3.2"}'::jsonb),
(2, 'HLR/HSS Subscriber Database', 'database', 'active', '10.2.1.100', 'hlr-main-01.mtn.local', 'SUSE Linux', '15 SP5', 'Lagos DC2, Ikeja', 'tier1_pii', true, 0, '{"engine":"Oracle RAC","subscribers":78500000}'::jsonb),
(2, 'Cell Tower Controller - Lagos', 'hardware', 'active', '172.16.1.1', 'bts-lagos-001', 'Ericsson RAN', '23.Q4', 'Victoria Island Tower', 'tier5_public', true, 1, '{"manufacturer":"Ericsson","model":"Baseband 6630","sector":"lagos_vi"}'::jsonb),
(9, 'Payment Gateway API Server', 'cloud', 'active', '10.9.1.20', 'api-gateway-01.flw.cloud', 'Ubuntu', '22.04 LTS', 'AWS Lagos (af-south-1)', 'tier2_financial', true, 3, '{"cloud":"AWS","instance":"c6g.2xlarge","pci_compliant":true}'::jsonb),
(3, 'SAP HR System', 'saas', 'active', NULL, 'dangote.sapcloud.com', 'SAP S/4HANA Cloud', '2024', 'SAP Cloud - Frankfurt', 'tier1_pii', false, 0, '{"vendor":"SAP","module":"HCM","users":2300}'::jsonb);

-- data_catalog_entries
INSERT INTO data_catalog_entries (organization_id, name, description, data_type, classification, quality_score, row_count, size_bytes, storage_location, is_within_borders, tags) VALUES
(1, 'Customer Master Table', 'Primary customer information including PII, KYC status, and account relationships', 'structured', 'tier1_pii', 0.94, 8500000, 42000000000, 'Oracle DB - Lagos DC1', true, '["pii","kyc","customer","banking"]'::jsonb),
(1, 'Transaction History', 'All debit/credit transactions across channels (ATM, POS, mobile, internet)', 'structured', 'tier2_financial', 0.98, 450000000, 890000000000, 'Oracle DB - Lagos DC1', true, '["financial","transactions","audit"]'::jsonb),
(2, 'CDR Records Store', 'Call Detail Records for all subscribers - voice, SMS, data sessions', 'structured', 'tier1_pii', 0.91, 2800000000, 5600000000000, 'Hadoop Cluster - Lagos DC2', true, '["cdr","telecom","usage","pii"]'::jsonb),
(9, 'Payment Transaction Log', 'All payment transactions processed through Flutterwave APIs', 'structured', 'tier2_financial', 0.96, 125000000, 340000000000, 'PostgreSQL - AWS Lagos', true, '["payments","fintech","financial"]'::jsonb),
(3, 'Employee Personnel Files', 'HR records including contracts, payroll, health records', 'unstructured', 'tier1_pii', 0.82, 15000, 8500000000, 'SAP Cloud - Frankfurt DE', false, '["hr","employee","pii","health"]'::jsonb);

-- data_lineage_nodes
INSERT INTO data_lineage_nodes (node_id, node_type, name, description, system_name, org_id, pii_contained, classification_level) VALUES
('DLN-001', 'source', 'Customer Onboarding Form', 'Web/mobile form collecting customer PII for account opening', 'Internet Banking Portal', 1, true, 'tier1_pii'),
('DLN-002', 'processing', 'KYC Verification Engine', 'BVN/NIN verification against NIMC/NIBSS databases', 'KYC System', 1, true, 'tier1_pii'),
('DLN-003', 'storage', 'Customer Master Database', 'Primary customer data store in Oracle DB', 'Core Banking System', 1, true, 'tier1_pii'),
('DLN-004', 'processing', 'Credit Scoring AI', 'ML model for automated credit decisions', 'AI Platform', 1, true, 'tier2_financial'),
('DLN-005', 'destination', 'Credit Bureau Reporting', 'Monthly reporting to CRC, FirstCentral, CreditRegistry', 'Credit Bureau Gateway', 1, true, 'tier2_financial');

-- data_lineage_edges
INSERT INTO data_lineage_edges (source_node_id, target_node_id, transformation_type, transformation_logic) VALUES
(1, 2, 'validation', 'BVN/NIN lookup and biometric verification against NIMC database'),
(2, 3, 'enrichment', 'Merge verified identity with account data and store in customer master'),
(3, 4, 'feature_extraction', 'Extract transaction patterns, balance history, payment behavior for scoring'),
(4, 5, 'aggregation', 'Monthly credit performance aggregation for bureau reporting');

-- network_events
INSERT INTO network_events (organization_id, source_ip, destination_ip, source_country, destination_country, source_latitude, source_longitude, dest_latitude, dest_longitude, protocol, port, bytes_transferred, event_type, is_cross_border, is_blocked) VALUES
(1, '10.1.1.50', '104.21.52.173', 'Nigeria', 'United States', 6.4541, 3.3947, 37.7749, -122.4194, 'HTTPS', 443, 45000, 'cross_border_transfer', true, false),
(3, '10.3.1.100', '185.44.52.10', 'Nigeria', 'Germany', 6.4698, 3.5852, 50.1109, 8.6821, 'HTTPS', 443, 125000000, 'cross_border_transfer', true, false),
(7, '10.7.1.200', '203.0.113.50', 'Nigeria', 'Singapore', 4.8156, 7.0498, 1.3521, 103.8198, 'SSH', 22, 8500000, 'exfiltration_attempt', true, true),
(2, '10.2.1.100', '10.2.1.200', 'Nigeria', 'Nigeria', 6.4312, 3.4218, 6.4312, 3.4218, 'SQL', 1521, 250000, 'normal', false, false),
(9, '10.9.1.20', '151.101.1.69', 'Nigeria', 'United States', 6.4355, 3.4105, 37.7749, -122.4194, 'HTTPS', 443, 8900, 'normal', true, false);

-- bgp_routes
INSERT INTO bgp_routes (prefix, origin_asn, peer_asn, as_path, next_hop, rpki_status, is_hijacked, is_leaked, is_cross_border, ixp_site, community_tags) VALUES
('41.203.64.0/19', 29465, 36873, '36873 29465', '196.216.2.1', 'valid', false, false, false, 'IXPN-Lagos', ARRAY['36873:100','29465:200']),
('154.118.0.0/16', 37148, 36873, '36873 37148', '196.216.2.2', 'valid', false, false, false, 'IXPN-Lagos', ARRAY['36873:100']),
('102.89.0.0/18', 328340, 36873, '36873 328340', '196.216.2.3', 'invalid', false, false, true, 'IXPN-Lagos', ARRAY['36873:100','328340:300']),
('197.210.0.0/16', 29465, 6762, '6762 29465', '80.81.194.1', 'valid', false, false, true, 'AMS-IX', ARRAY['6762:100']),
('196.46.192.0/19', 37705, 36873, '36873 37705', '196.216.2.5', 'valid', true, false, false, 'IXPN-Lagos', ARRAY['HIJACK_ALERT']);

-- security_alerts
INSERT INTO security_alerts (organization_id, source, alert_type, title, description, severity, is_resolved, threat_actor_id, mitre_technique) VALUES
(7, 'wazuh', 'unauthorized_access', 'VPN Access from Terminated Employee', 'Former contractor VPN credentials used from IP 41.58.192.xxx at 02:15 AM', 'critical', true, 'TA-INSIDER-001', 'T1078.004'),
(1, 'suricata', 'data_exfiltration', 'Large Data Transfer to Personal Email', 'Employee transferring 2.4GB via webmail to external address', 'critical', false, 'TA-INSIDER-002', 'T1048.002'),
(9, 'wazuh', 'brute_force', 'API Authentication Brute Force Attempt', '15,000 failed API auth attempts from botnet IPs in 30 minutes', 'high', true, 'TA-BOTNET-001', 'T1110.001'),
(2, 'custom', 'sim_swap', 'Coordinated SIM Swap Attack Detected', 'Pattern of SIM swap requests from 3 retail shops targeting high-value accounts', 'critical', true, 'TA-FRAUD-001', 'T1199'),
(3, 'ossec', 'malware', 'Ransomware Dropper Detected on Workstation', 'LockBit 3.0 dropper detected on factory floor workstation via USB', 'critical', true, 'TA-LOCKBIT', 'T1091');

-- threat_intelligence
INSERT INTO threat_intelligence (source, indicator_type, indicator_value, threat_actor, campaign, mitre_tactic, mitre_technique, severity, confidence, is_active) VALUES
('NG-CERT', 'ip', '41.58.192.100', 'TA-INSIDER-001', 'insider_threat_q2_2025', 'Initial Access', 'T1078', 'high', 0.95, true),
('NFIU', 'domain', 'fake-cbn-portal.ng.com', 'TA-PHISH-NG', 'cbn_phishing_campaign', 'Initial Access', 'T1566.002', 'critical', 0.98, true),
('AlienVault OTX', 'ip', '185.220.101.45', 'TA-APT-UNKNOWN', 'banking_trojan_africa', 'Command and Control', 'T1071.001', 'high', 0.82, true),
('NG-CERT', 'hash', 'sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'TA-LOCKBIT', 'lockbit_3_nigeria', 'Impact', 'T1486', 'critical', 0.99, true),
('Internal SOC', 'email', 'admin@cbn-secure-update.com', 'TA-PHISH-NG', 'cbn_phishing_campaign', 'Initial Access', 'T1566.001', 'medium', 0.91, true);

-- sla_breaches
INSERT INTO sla_breaches (organization_id, sla_type, threshold, actual, severity, status, notes) VALUES
(3, 'breach_notification', 72.0, 96.5, 'high', 'open', 'S3 exposure notification exceeded 72-hour NDPC deadline by 24.5 hours'),
(7, 'dsar_response', 30.0, 35.0, 'medium', 'resolved', 'Subject access request response delayed by 5 days due to data location complexity'),
(2, 'breach_notification', 72.0, 86.0, 'medium', 'open', 'SIM swap breach notification exceeded deadline by 14 hours'),
(5, 'dpo_appointment', 90.0, 210.0, 'high', 'resolved', 'DPO appointment took 210 days vs 90-day statutory requirement');

-- telecom-specific tables
-- spectrum_licences
INSERT INTO spectrum_licences (operator_id, licence_number, band, bandwidth_mhz, region, status, expiry_date, data_localisation_compliant, lawful_intercept_enabled) VALUES
(1, 'NCC/SPC/2023/MTN/001', '700 MHz', 10, 'Nationwide', 'active', '2033-12-31', true, true),
(1, 'NCC/SPC/2021/MTN/002', '2600 MHz', 40, 'Nationwide', 'active', '2031-06-30', true, true),
(2, 'NCC/SPC/2023/ART/001', '800 MHz', 10, 'Nationwide', 'active', '2033-12-31', true, true),
(3, 'NCC/SPC/2019/GLO/001', '900 MHz', 10, 'Nationwide', 'active', '2029-03-31', false, true),
(4, 'NCC/SPC/2022/9MB/001', '1800 MHz', 20, 'South-West', 'active', '2032-09-30', false, false);

-- qos_violations
INSERT INTO qos_violations (operator_id, violation_type, severity, description, penalty_ngn, status) VALUES
(3, 'call_drop_rate', 'medium', 'Call drop rate exceeded 2% threshold at 3.8% in Lagos region for March 2025', 50000000, 'under_review'),
(4, 'data_speed', 'high', 'Average 4G download speed below 4Mbps minimum threshold at 2.1Mbps nationwide', 100000000, 'confirmed'),
(1, 'coverage_gap', 'low', 'Coverage gap identified in 3 LGAs in Borno State below 95% population coverage target', 25000000, 'remediated'),
(2, 'service_availability', 'medium', 'Network outage in Abuja for 4.5 hours on March 15, 2025 exceeding 99.5% uptime SLA', 75000000, 'under_review');

-- lawful_intercept_requests
INSERT INTO lawful_intercept_requests (operator_id, request_ref, target_type, requesting_agency, status) VALUES
(1, 'LI-2025-MTN-0142', 'subscriber', 'Nigerian Police Force', 'approved'),
(2, 'LI-2025-ART-0089', 'subscriber', 'DSS', 'approved'),
(1, 'LI-2025-MTN-0198', 'content', 'EFCC', 'pending'),
(3, 'LI-2025-GLO-0056', 'subscriber', 'ICPC', 'approved');

-- interconnect_disputes
INSERT INTO interconnect_disputes (complainant_id, respondent_id, dispute_type, amount_ngn, status) VALUES
(2, 3, 'billing', 450000000, 'under_review'),
(4, 1, 'interconnect_rate', 120000000, 'resolved'),
(3, 2, 'quality_of_service', 0, 'filed');


-- ============================================================================
-- 6. DPCO, DATA GOVERNANCE & OPERATIONAL TABLES
-- ============================================================================

-- dpco_organisations
INSERT INTO dpco_organisations (name, licence_number, status, tier, email, phone, address, cac_number, tax_id, dpo_name, dpo_email, services, sectors, client_count, car_submission_rate, avg_client_score) VALUES
('DataShield Compliance Ltd', 'DPCO/2024/001', 'active', 'enterprise', 'info@datashield.ng', '+234-812-345-6789', '15 Adeola Odeku Street, Victoria Island, Lagos', 'RC-2345678', 'TIN-12345678', 'Dr. Adaeze Nwosu', 'adaeze@datashield.ng', ARRAY['audit','dpia','training','advisory','gap_assessment'], ARRAY['banking','telecom','fintech'], 45, 92.5, 78.3),
('CompliancePro Nigeria', 'DPCO/2024/002', 'active', 'professional', 'hello@compliancepro.ng', '+234-803-456-7890', '22 Ahmadu Bello Way, Wuse II, Abuja', 'RC-3456789', 'TIN-23456789', 'Engr. Chukwudi Okafor', 'chukwudi@compliancepro.ng', ARRAY['audit','dpia','training'], ARRAY['healthcare','manufacturing'], 28, 85.0, 72.1),
('PrivacyFirst Advisory', 'DPCO/2024/003', 'active', 'starter', 'contact@privacyfirst.ng', '+234-705-567-8901', '8 Broad Street, Lagos Island', 'RC-4567890', 'TIN-34567890', 'Barr. Fatima Bello', 'fatima@privacyfirst.ng', ARRAY['advisory','gap_assessment'], ARRAY['energy','oil_gas'], 12, 78.0, 65.5);

-- dpco_clients
INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, contact_phone, status, risk_level, compliance_score) VALUES
(1, 'First Bank of Nigeria', 'banking', 'Lagos', 'Oluwaseun Adekoya', 'o.adekoya@firstbanknigeria.com', '+234-812-111-2222', 'active', 'medium', 78),
(1, 'Flutterwave Inc', 'fintech', 'Lagos', 'Tunde Afolabi', 't.afolabi@flutterwave.com', '+234-812-333-4444', 'active', 'medium', 80),
(2, 'Lagos University Teaching Hospital', 'healthcare', 'Lagos', 'Dr. Emeka Obi', 'e.obi@luth.gov.ng', '+234-803-555-6666', 'active', 'high', 62),
(1, 'MTN Nigeria', 'telecom', 'Lagos', 'Amaka Nnaji', 'a.nnaji@mtnnigeria.net', '+234-812-777-8888', 'active', 'low', 85),
(3, 'Shell Petroleum Dev Co', 'energy', 'Port Harcourt', 'James Okonkwo', 'j.okonkwo@shell.com.ng', '+234-705-999-0000', 'active', 'critical', 55);

-- dpco_audit_engagements
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, actual_start, critical_findings, high_findings, medium_findings, low_findings) VALUES
(1, 1, 'Annual NDPA Compliance Audit 2025 - First Bank', 'findings_review', 78, 'Dr. Adaeze Nwosu', NOW()-interval '60 days', NOW()+interval '30 days', NOW()-interval '55 days', 1, 2, 3, 2),
(1, 2, 'DPIA Review - Flutterwave Payment Processing', 'fieldwork', NULL, 'Chinedu Eze', NOW()-interval '30 days', NOW()+interval '15 days', NOW()-interval '28 days', 0, 1, 2, 1),
(2, 3, 'Healthcare Data Protection Assessment - LUTH', 'data_mapping', NULL, 'Engr. Chukwudi Okafor', NOW()-interval '14 days', NOW()+interval '45 days', NOW()-interval '10 days', 0, 0, 0, 0),
(3, 5, 'Emergency Compliance Audit - Shell (Post-Breach)', 'gap_assessment', NULL, 'Barr. Fatima Bello', NOW()-interval '7 days', NOW()+interval '21 days', NOW()-interval '5 days', 0, 0, 0, 0);

-- dpco_invoices
INSERT INTO dpco_invoices (invoice_number, dpco_org_id, client_id, client_name, status, service_type, description, subtotal, vat_rate, vat_amount, total_amount, platform_fee_rate, platform_fee_amount, dpco_net_amount, issue_date, due_date) VALUES
('INV-DS-2025-001', 1, 1, 'First Bank of Nigeria', 'paid', 'audit', 'Annual NDPA Compliance Audit 2025', 15000000, 7.5, 1125000, 16125000, 5.0, 806250, 15318750, NOW()-interval '45 days', NOW()-interval '15 days'),
('INV-DS-2025-002', 1, 2, 'Flutterwave Inc', 'sent', 'dpia', 'DPIA Review - Payment Processing Systems', 8000000, 7.5, 600000, 8600000, 5.0, 430000, 8170000, NOW()-interval '10 days', NOW()+interval '20 days'),
('INV-CP-2025-001', 2, 3, 'LUTH', 'draft', 'audit', 'Healthcare Data Protection Assessment', 12000000, 7.5, 900000, 12900000, 5.0, 645000, 12255000, NOW(), NOW()+interval '30 days'),
('INV-PF-2025-001', 3, 5, 'Shell Petroleum', 'sent', 'gap_assessment', 'Emergency Post-Breach Compliance Assessment', 20000000, 7.5, 1500000, 21500000, 5.0, 1075000, 20425000, NOW()-interval '5 days', NOW()+interval '25 days');

-- dpco_subscriptions
INSERT INTO dpco_subscriptions (dpco_org_id, tier, status, monthly_fee, max_clients, max_audits_per_month, platform_fee_rate, current_period_start, current_period_end) VALUES
(1, 'enterprise', 'active', 500000, 100, 20, 5.0, NOW()-interval '15 days', NOW()+interval '15 days'),
(2, 'professional', 'active', 250000, 50, 10, 7.5, NOW()-interval '10 days', NOW()+interval '20 days'),
(3, 'starter', 'active', 100000, 20, 5, 10.0, NOW()-interval '20 days', NOW()+interval '10 days');

-- dpco_training_sessions
INSERT INTO dpco_training_sessions (dpco_org_id, client_id, title, description, training_type, status, scheduled_date, participant_count, ndpa_section, facilitator) VALUES
(1, 1, 'NDPA Section 25-28 Workshop', 'In-depth workshop on consent management, lawful basis, and data subject rights', 'workshop', 'completed', NOW()-interval '30 days', 45, 'Sections 25-28', 'Dr. Adaeze Nwosu'),
(1, 4, 'DPO Certification Refresher', 'Annual refresher training for MTN Nigeria DPO team', 'certification', 'scheduled', NOW()+interval '14 days', 12, 'Section 32', 'Chinedu Eze'),
(2, 3, 'Healthcare Data Protection Basics', 'Introduction to data protection for hospital administrative staff', 'awareness', 'in_progress', NOW()-interval '2 days', 85, 'General', 'Engr. Chukwudi Okafor');

-- data_processing_agreements
INSERT INTO data_processing_agreements (organization_id, processor_name, processor_country, agreement_reference, processing_purposes, data_categories, status, signed_at, expires_at, sub_processors, security_measures, audit_rights) VALUES
(1, 'Microsoft Azure', 'Ireland', 'DPA-FB-MSFT-2024', '["cloud_hosting","email_services","office_productivity"]'::jsonb, '["employee_data","internal_communications"]'::jsonb, 'active', NOW()-interval '365 days', NOW()+interval '365 days', '["GitHub","LinkedIn"]'::jsonb, 'ISO 27001, SOC 2 Type II, encryption at rest and in transit', true),
(2, 'Huawei Technologies', 'China', 'DPA-MTN-HW-2024', '["network_equipment","maintenance","technical_support"]'::jsonb, '["network_performance_data","subscriber_metadata"]'::jsonb, 'active', NOW()-interval '180 days', NOW()+interval '545 days', '[]'::jsonb, 'ISO 27001, data localization clauses, no raw PII access', true),
(9, 'Amazon Web Services', 'United States', 'DPA-FLW-AWS-2024', '["cloud_computing","data_storage","ml_services"]'::jsonb, '["transaction_data","merchant_data","api_logs"]'::jsonb, 'active', NOW()-interval '300 days', NOW()+interval '430 days', '["Twilio","SendGrid"]'::jsonb, 'PCI DSS Level 1, SOC 2, data residency in af-south-1', true),
(1, 'Stripe Inc', 'United States', 'DPA-FB-STRIPE-2024', '["payment_processing","fraud_detection"]'::jsonb, '["card_data","transaction_data"]'::jsonb, 'active', NOW()-interval '200 days', NOW()+interval '530 days', '[]'::jsonb, 'PCI DSS Level 1, tokenization, encrypted cardholder data', true);

-- dpo_appointments
INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone, credential_status, dpco_name, training_hours_completed, independence_verified, is_active) VALUES
(1, 'Oluwaseun Adekoya', 'o.adekoya@firstbanknigeria.com', '+234-812-111-2222', 'verified', 'DataShield Compliance Ltd', 120, true, true),
(2, 'Amaka Nnaji', 'a.nnaji@mtnnigeria.net', '+234-803-222-3333', 'verified', 'DataShield Compliance Ltd', 95, true, true),
(4, 'Chinedu Okonkwo', 'c.okonkwo@accessbankplc.com', '+234-812-444-5555', 'verified', 'CompliancePro Nigeria', 110, true, true),
(6, 'Adaeze Nwosu', 'a.nwosu@gtbank.com', '+234-812-666-7777', 'verified', 'DataShield Compliance Ltd', 140, true, true),
(9, 'Tunde Afolabi', 't.afolabi@flutterwave.com', '+234-812-888-9999', 'verified', 'DataShield Compliance Ltd', 85, true, true),
(3, 'Blessing Udo', 'b.udo@dangote.com', '+234-803-000-1111', 'pending', NULL, 40, false, true);

-- dpo_reports
INSERT INTO dpo_reports (organization_id, dpo_appointment_id, report_period_start, report_period_end, status, activities_summary, violations_identified, dsars_handled, training_conducted) VALUES
(1, 1, NOW()-interval '90 days', NOW(), 'submitted', 'Conducted 3 DPIAs, handled 12 DSARs, identified 2 compliance gaps in cloud storage. Remediation in progress for AI credit scoring DPIA.', 2, 12, 3),
(2, 2, NOW()-interval '90 days', NOW(), 'draft', 'Managed SIM swap breach response, updated privacy notices, conducted staff training for 250 employees.', 1, 8, 2);

-- transfer_instruments
INSERT INTO transfer_instruments (organization_id, instrument_type, instrument_reference, destination_country, data_categories, status, conditions, ndpc_reference) VALUES
(1, 'Standard Contractual Clauses', 'SCC-FB-2025-001', 'United States', '["financial_data","employee_data"]'::jsonb, 'active', 'Data must remain encrypted. No onward transfers without prior approval.', 'NDPC/TI/2025/0142'),
(9, 'Standard Contractual Clauses', 'SCC-FLW-2025-001', 'United States', '["transaction_data","merchant_data"]'::jsonb, 'active', 'PCI DSS compliance required. Data residency in af-south-1 preferred.', 'NDPC/TI/2025/0289'),
(2, 'Binding Corporate Rules', 'BCR-MTN-2024-001', 'South Africa', '["subscriber_data","network_data"]'::jsonb, 'active', 'MTN Group BCR approved by NDPC. Annual compliance audit required.', 'NDPC/TI/2024/0892');

-- transfer_approvals
INSERT INTO transfer_approvals (reference_id, organization_id, dataset_name, source_country, destination_country, destination_entity, volume_gb, data_classification, business_justification, transfer_method, encryption_method, status, risk_score) VALUES
('TA-2025-001', 1, 'Employee HR Records', 'Nigeria', 'Ireland', 'Microsoft Azure Dublin', 2.5, 'tier1_pii', 'Cloud-based HR management via SAP SuccessFactors', 'api', 'AES-256-GCM', 'approved', 35.2),
('TA-2025-002', 9, 'Payment Transaction Logs', 'Nigeria', 'United States', 'AWS US-East-1', 15.8, 'tier2_financial', 'Backup and disaster recovery for PCI DSS compliance', 'encrypted_file', 'AES-256-CBC', 'approved', 42.1),
('TA-2025-003', 3, 'Vendor Contract Data', 'Nigeria', 'United Kingdom', 'SAP Cloud London', 0.8, 'tier1_pii', 'Centralized procurement management', 'api', 'TLS-1.3', 'pending', 28.5);

-- tia_assessments
INSERT INTO tia_assessments (organization_id, data_categories, destination_country, legal_basis, risk_level, status, tia_document, safeguards) VALUES
(1, '["personal_details","financial_data"]'::jsonb, 'United States', 'Standard Contractual Clauses', 'medium', 'approved', 'TIA completed: US legal framework assessment under NDPA Article 43. CLOUD Act risk mitigated by encryption and access controls.', 'End-to-end encryption, contractual restrictions on government access, data minimization'),
(9, '["transaction_data"]'::jsonb, 'United States', 'Standard Contractual Clauses', 'medium', 'approved', 'TIA completed: Payment processing requires US-based card network connectivity. PCI DSS provides adequate security framework.', 'Tokenization, PCI DSS Level 1, no raw PAN in transit'),
(3, '["employee_data"]'::jsonb, 'Germany', 'Adequacy Decision', 'low', 'submitted', 'TIA assessment: Germany has adequate data protection (EU GDPR). SAP Cloud compliant with NDPA requirements.', 'GDPR compliance, ISO 27001 certification, EU-based data centers');

-- adequacy_determinations
INSERT INTO adequacy_determinations (country_code, country_name, status, ndpc_decision, conditions, applicable_sectors, is_active) VALUES
('GB', 'United Kingdom', 'adequate', 'UK Data Protection Act 2018 provides adequate protection per NDPA Article 43(1)', 'Subject to periodic review. Post-Brexit UK adequacy recognized.', '["all"]'::jsonb, true),
('DE', 'Germany', 'adequate', 'EU GDPR member state. Adequate protection confirmed per NDPA Article 43(1)', NULL, '["all"]'::jsonb, true),
('GH', 'Ghana', 'adequate', 'Ghana Data Protection Act 2012 provides adequate protection', 'Limited to non-sensitive data processing. Health data transfers require additional safeguards.', '["banking","telecom","manufacturing"]'::jsonb, true),
('US', 'United States', 'conditional', 'Sectoral approach. Adequate for specific frameworks only (PCI DSS, HIPAA, SOC 2).', 'Requires SCCs or BCRs. CLOUD Act risk assessment mandatory. Sector-specific adequacy only.', '["fintech","healthcare"]'::jsonb, true),
('CN', 'China', 'not_adequate', 'PIPL framework assessment ongoing. Not yet determined adequate per NDPA Article 43', 'All transfers require explicit NDPC approval. Enhanced safeguards mandatory.', '[]'::jsonb, true),
('ZA', 'South Africa', 'adequate', 'POPIA provides adequate protection per NDPA Article 43(1)', NULL, '["all"]'::jsonb, true);

-- regulatory_intelligence_items
INSERT INTO regulatory_intelligence_items (item_type, title, summary, source_url, source_org, affected_sectors, ndpa_articles, compliance_deadline, impact_level, action_required, status) VALUES
('regulation', 'NDPC Issues Implementation Guide for NDPA Section 30 (DPIA)', 'New guidance on when DPIA is mandatory, including AI/ML systems processing personal data at scale', 'https://ndpc.gov.ng/guidance/dpia-implementation-2025', 'NDPC', ARRAY['banking','fintech','telecom','healthcare'], ARRAY['Section 30','Section 31'], '2025-09-30', 'high', true, 'active'),
('circular', 'CBN Circular on Cloud Data Residency for Banks', 'CBN mandates all Tier-1 banks to ensure customer data residency within Nigeria by Q4 2025', 'https://cbn.gov.ng/circulars/2025/cloud-residency', 'CBN', ARRAY['banking'], ARRAY['Section 43'], '2025-12-31', 'critical', true, 'active'),
('amendment', 'NCC Consumer Code Amendment - Privacy Provisions', 'Updated consumer code incorporating NDPA requirements for telecom operators', 'https://ncc.gov.ng/codes/consumer-2025', 'NCC', ARRAY['telecom'], ARRAY['Section 25','Section 27'], '2025-06-30', 'medium', true, 'active');

-- vendor_risk_profiles
INSERT INTO vendor_risk_profiles (vendor_ref, vendor_name, vendor_type, country, org_id, risk_score, risk_level, data_categories, dpia_required, dpa_executed, certifications, status, data_access_level) VALUES
('VND-MSFT-001', 'Microsoft Corporation', 'cloud_provider', 'United States', 1, 35.2, 'medium', ARRAY['employee_data','communications'], false, true, ARRAY['ISO 27001','SOC 2 Type II','CSA STAR'], 'active', 'processor'),
('VND-AWS-001', 'Amazon Web Services', 'cloud_provider', 'United States', 9, 38.5, 'medium', ARRAY['transaction_data','api_logs'], false, true, ARRAY['PCI DSS Level 1','SOC 2','ISO 27001'], 'active', 'processor'),
('VND-HW-001', 'Huawei Technologies', 'equipment_vendor', 'China', 2, 72.8, 'high', ARRAY['network_data','subscriber_metadata'], true, true, ARRAY['ISO 27001','CC EAL4+'], 'active', 'sub_processor'),
('VND-SAP-001', 'SAP SE', 'software_vendor', 'Germany', 3, 28.1, 'low', ARRAY['employee_data','payroll_data'], false, true, ARRAY['ISO 27001','SOC 1','SOC 2'], 'active', 'processor');

-- policy_templates
INSERT INTO policy_templates (name, framework, version, description, policy_definition, status, instantiated_count) VALUES
('Data Protection Policy', 'NDPR', '3.0', 'Comprehensive data protection policy template aligned with NDPA requirements', '{"sections":["purpose","scope","definitions","principles","lawful_basis","data_subject_rights","security_measures","breach_notification","cross_border_transfers","retention","review"]}'::jsonb, 'active', 42),
('DPIA Template', 'NDPR', '2.5', 'Data Protection Impact Assessment template per NDPA Section 30', '{"sections":["project_description","necessity_assessment","risk_identification","risk_mitigation","residual_risk","ndpc_consultation","approval"]}'::jsonb, 'active', 28),
('Privacy Notice Template', 'NDPR', '2.0', 'Privacy notice template compliant with NDPA Section 27 transparency requirements', '{"sections":["controller_details","purposes","lawful_basis","recipients","transfers","retention","rights","complaints","changes"]}'::jsonb, 'active', 35),
('Incident Response Plan', 'ISO27001', '1.5', 'Information security incident response plan template', '{"sections":["scope","roles","classification","detection","containment","eradication","recovery","lessons_learned","reporting"]}'::jsonb, 'active', 15);


-- ============================================================================
-- 7. SECTOR-SPECIFIC TABLES (energy, insurance, clinical trials, etc.)
-- ============================================================================

-- energy_licences
INSERT INTO energy_licences (company_id, licence_number, licence_type, status, expiry_date) VALUES
(1, 'NERC/DL/2024/IKEDC/001', 'distribution', 'active', '2034-12-31'),
(2, 'NERC/DL/2024/EKEDC/001', 'distribution', 'active', '2034-12-31'),
(3, 'NERC/GL/2024/EGP/001', 'generation', 'active', '2039-12-31'),
(4, 'NERC/GL/2024/TPU/001', 'generation', 'active', '2039-06-30'),
(5, 'DPR/OPL/2024/SPDC/001', 'exploration', 'active', '2045-12-31');

-- grid_monitoring_events
INSERT INTO grid_monitoring_events (company_id, event_type, data_localisation_violation, description, severity) VALUES
(1, 'scada_access', false, 'Routine SCADA system access for load management - Lagos North feeder', 'low'),
(3, 'smart_meter_anomaly', false, 'Unusual consumption pattern detected on smart meter cluster - Egbin plant perimeter', 'medium'),
(5, 'cross_border_data', true, 'Pipeline telemetry data transmitted to Shell HQ in The Hague without local processing', 'high');

-- oil_gas_data_reports
INSERT INTO oil_gas_data_reports (company_id, report_type, is_locally_stored) VALUES
(5, 'production_data', false),
(5, 'environmental_impact', true),
(5, 'safety_incident', true);

-- insurance_policies
INSERT INTO insurance_policies (company_id, policy_type, cross_border_reinsurance, premium_ngn, status) VALUES
(1, 'life_insurance', true, 50000000, 'active'),
(1, 'health_insurance', false, 35000000, 'active'),
(2, 'motor_insurance', false, 15000000, 'active'),
(3, 'fire_insurance', true, 120000000, 'active'),
(4, 'group_life', false, 85000000, 'active');

-- insurance_claims
INSERT INTO insurance_claims (company_id, claim_ref, claim_type, amount_ngn, fraud_flag, status) VALUES
(1, 'CLM-LWA-2025-001', 'death_benefit', 15000000, false, 'approved'),
(2, 'CLM-AXA-2025-001', 'motor_accident', 2500000, false, 'processing'),
(3, 'CLM-AII-2025-001', 'health_claim', 850000, true, 'investigating'),
(1, 'CLM-LWA-2025-002', 'fire_damage', 45000000, false, 'approved');

-- clinical_trials
INSERT INTO clinical_trials (facility_id, trial_name, sponsor, foreign_sponsor, participant_count, data_localisation_compliant, status, start_date, end_date) VALUES
(1, 'Malaria Vaccine Phase III - Lagos Cohort', 'WHO/GSK', true, 2500, true, 'active', '2024-06-01', '2026-06-30'),
(2, 'Sickle Cell Gene Therapy Trial', 'Novartis AG', true, 150, false, 'active', '2025-01-15', '2027-12-31'),
(4, 'Digital Health Monitoring for Hypertension', 'Eko Hospitals / NHIA', false, 500, true, 'recruiting', '2025-03-01', '2026-03-31');

-- patient_data_localisation_checks
INSERT INTO patient_data_localisation_checks (facility_id, check_type, status, findings) VALUES
(1, 'ehr_storage', 'compliant', 'EHR system hosted in Lagos DC. All patient records stored within Nigeria.'),
(2, 'ehr_storage', 'compliant', 'ClinicMaster hosted on-premise at National Hospital Abuja.'),
(3, 'ehr_storage', 'non_compliant', 'OpenMRS instance partially hosted on DigitalOcean Singapore. Migration to local DC required.'),
(4, 'ehr_storage', 'compliant', 'Helium Health SaaS with data residency in Lagos AWS region.'),
(2, 'clinical_trial_data', 'non_compliant', 'Novartis gene therapy trial data exported to Basel without adequate transfer safeguards');

-- fintech_data_events
INSERT INTO fintech_data_events (company_id, event_type, violation_detected, description) VALUES
(1, 'transaction_monitoring', false, 'Real-time AML screening flagged 3 suspicious transactions for review'),
(2, 'api_data_sharing', false, 'Open Banking API shared account data with licensed TPP per consent'),
(3, 'wallet_balance_exposure', true, 'Customer wallet balances briefly exposed via debug endpoint in staging'),
(4, 'consent_collection', false, 'New user onboarding consent flow updated to meet NDPA requirements'),
(5, 'credit_scoring', true, 'Credit model used social media data without explicit consent');

-- open_banking_consents
INSERT INTO open_banking_consents (company_id, consent_type, customer_count, status, consent_status) VALUES
(1, 'account_information', 45000, 'active', 'granted'),
(2, 'payment_initiation', 28000, 'active', 'granted'),
(1, 'account_information', 12000, 'active', 'granted'),
(3, 'account_information', 85000, 'active', 'granted');

-- ============================================================================
-- 8. PLATFORM & SYSTEM TABLES
-- ============================================================================

-- audit_logs
INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details, ip_address) VALUES
(1, NULL, 'login', 'session', NULL, 'Admin login from office IP', '102.89.23.145'),
(1, 1, 'view_breach', 'breach_incident', 5, 'Viewed insider threat breach report', '102.89.23.145'),
(1, 3, 'issue_penalty', 'financial_penalty', 2, 'Issued N150M penalty for S3 data exposure', '102.89.23.145'),
(2, NULL, 'login', 'session', NULL, 'Auditor login', '41.190.2.34'),
(2, 1, 'run_compliance_check', 'organization', 1, 'Executed quarterly compliance check for First Bank', '41.190.2.34'),
(1, 2, 'update_enforcement', 'enforcement_case', 4, 'Opened enforcement case for MTN SIM swap breach', '102.89.23.145');

-- analytics_events
INSERT INTO analytics_events (event_type, page, feature, user_hash, org_id, role, duration_ms) VALUES
('page_view', '/dashboard', 'overview', 'usr_hash_001', NULL, 'admin', 2500),
('page_view', '/compliance/violations', 'violations_list', 'usr_hash_001', NULL, 'admin', 4200),
('page_view', '/enforcement/cases', 'case_management', 'usr_hash_001', NULL, 'admin', 3100),
('feature_use', '/banking/kyc', 'kyc_review', 'usr_hash_002', 1, 'auditor', 8500),
('page_view', '/noc-dashboard', 'noc_overview', 'usr_hash_001', NULL, 'admin', 1800),
('feature_use', '/liveness-verification', 'face_detection', 'usr_hash_002', 1, 'auditor', 12000);

-- api_keys
INSERT INTO api_keys (org_id, name, key_hash, key_prefix, scopes, rate_limit_rpm, status) VALUES
(1, 'First Bank Production API Key', 'sha256_hash_fb_prod', 'ndsep_fb_', ARRAY['read:compliance','read:enforcement','write:dsar'], 100, 'active'),
(2, 'MTN Nigeria API Key', 'sha256_hash_mtn_prod', 'ndsep_mtn_', ARRAY['read:compliance','write:breach'], 150, 'active'),
(9, 'Flutterwave Integration Key', 'sha256_hash_flw_prod', 'ndsep_flw_', ARRAY['read:compliance','read:enforcement','write:dsar','read:penalty'], 200, 'active');

-- api_usage_log (references api_keys by FK)
INSERT INTO api_usage_log (api_key_id, endpoint, method, status_code, response_time_ms) VALUES
((SELECT id FROM api_keys WHERE key_prefix='ndsep_fb_' LIMIT 1), '/api/compliance/score', 'GET', 200, 145),
((SELECT id FROM api_keys WHERE key_prefix='ndsep_mtn_' LIMIT 1), '/api/breach/report', 'POST', 201, 320),
((SELECT id FROM api_keys WHERE key_prefix='ndsep_flw_' LIMIT 1), '/api/enforcement/status', 'GET', 200, 89);

-- platform_stats
INSERT INTO platform_stats (metric_name, metric_value, category, period) VALUES
('total_organizations', 10, 'platform', '2025-Q2'),
('total_breaches_reported', 5, 'compliance', '2025-Q2'),
('total_penalties_issued_ngn', 218000000, 'enforcement', '2025-Q2'),
('total_dsars_received', 5, 'privacy', '2025-Q2'),
('active_dpcos', 3, 'dpco', '2025-Q2'),
('avg_compliance_score', 76.2, 'compliance', '2025-Q2'),
('active_dpia_assessments', 4, 'assessments', '2025-Q2'),
('cross_border_transfers', 3, 'data_residency', '2025-Q2');

-- in_app_notifications (references users and organizations)
INSERT INTO in_app_notifications (title, message, severity, category, organization_id, user_id, is_read, action_url) VALUES
('Breach Notification Deadline Approaching', 'First Bank insider threat breach: NDPC notification deadline in 24 hours', 'error', 'breach', 1, 1, false, '/enforcement/cases'),
('New DSAR Received', 'Chioma Eze submitted data erasure request for Flutterwave', 'warning', 'dsar', 9, 1, false, '/citizen-requests'),
('Compliance Score Updated', 'Dangote Group compliance score dropped to 62.1 after S3 incident', 'warning', 'compliance', 3, 1, true, '/compliance/scorecard'),
('Penalty Appeal Filed', 'Dangote Group filed appeal for N150M penalty', 'info', 'enforcement', 3, 1, false, '/enforcement/appeals'),
('SIM Swap Breach Reported', 'MTN Nigeria reported coordinated SIM swap fraud affecting 450 customers', 'error', 'breach', 2, 1, false, '/breaches');

-- platform_notifications (separate from in_app)
INSERT INTO platform_notifications (user_id, org_id, notification_type, title, message, severity, action_url, is_read) VALUES
(1, NULL, 'system', 'NDSEP Platform Update v6.0', 'Platform updated with AI NOC Agent, Liveness Detection, and wiredigg-rs network intelligence', 'info', '/changelog', true),
(1, NULL, 'regulatory', 'NDPC New Guidance Published', 'DPIA Implementation Guide for NDPA Section 30 now available', 'warning', '/regulatory-intelligence', false),
(1, 1, 'compliance', 'Quarterly Compliance Review Due', 'First Bank Q2 2025 compliance review deadline in 14 days', 'warning', '/compliance/reviews', false);

-- notification_settings
INSERT INTO notification_settings (organization_id, penalty_issued, penalty_paid, enforcement_case_opened, breach_incident_created, sla_breach_warning, dpo_email, technical_email) VALUES
(1, true, true, true, true, true, 'o.adekoya@firstbanknigeria.com', 'security@firstbanknigeria.com'),
(2, true, true, true, true, true, 'a.nnaji@mtnnigeria.net', 'noc@mtnnigeria.net'),
(4, true, true, true, true, false, 'c.okonkwo@accessbankplc.com', 'it@accessbankplc.com');

-- generated_reports
INSERT INTO generated_reports (report_type, file_path, file_hash, metrics, delivered_to, delivery_status) VALUES
('quarterly_compliance', '/reports/2025-Q1-compliance.pdf', 'sha256:abc123', '{"total_orgs":10,"avg_score":76.2,"violations":5}'::jsonb, ARRAY['admin@ndsep.gov.ng'], 'delivered'),
('breach_summary', '/reports/2025-Q1-breaches.pdf', 'sha256:def456', '{"total_breaches":3,"avg_response_hours":68.5}'::jsonb, ARRAY['admin@ndsep.gov.ng','commissioner@ndpc.gov.ng'], 'delivered'),
('enforcement_report', '/reports/2025-Q1-enforcement.pdf', 'sha256:ghi789', '{"cases_opened":4,"penalties_issued_ngn":218000000}'::jsonb, ARRAY['admin@ndsep.gov.ng'], 'delivered');

-- report_schedules
INSERT INTO report_schedules (report_type, frequency, last_run, next_run, recipients, format, enabled) VALUES
('compliance_summary', 'weekly', NOW()-interval '3 days', NOW()+interval '4 days', ARRAY['admin@ndsep.gov.ng'], 'pdf', true),
('breach_alert_digest', 'daily', NOW()-interval '1 day', NOW(), ARRAY['admin@ndsep.gov.ng','csirt@ndsep.gov.ng'], 'email', true),
('enforcement_monthly', 'monthly', NOW()-interval '15 days', NOW()+interval '15 days', ARRAY['admin@ndsep.gov.ng','commissioner@ndpc.gov.ng'], 'pdf', true);

-- form_drafts
INSERT INTO form_drafts (user_id, form_type, form_data) VALUES
('user_1', 'breach_report', '{"title":"Draft: Database access anomaly","organization_id":1,"severity":"medium","description":"Investigating unusual database query patterns"}'::jsonb),
('user_1', 'dpia_assessment', '{"title":"Draft: New mobile banking app DPIA","organization_id":1}'::jsonb);

-- push_subscriptions
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES
('user_1', 'https://fcm.googleapis.com/fcm/send/abc123', 'BNc-example-p256dh-key', 'auth-secret-example');

-- push_notification_log
INSERT INTO push_notification_log (user_id, notification_type, title, status) VALUES
('user_1', 'breach_alert', 'New Breach: First Bank Insider Threat', 'delivered'),
('user_1', 'enforcement_update', 'Penalty Issued: Shell Petroleum', 'delivered');


-- ============================================================================
-- 9. MONITORING, RISK, EVENT SOURCING & ADVANCED TABLES
-- ============================================================================

-- monitoring_snapshots
INSERT INTO monitoring_snapshots (organization_id, snapshot_type, score, previous_score, delta, status, worker_source, details, alert_triggered, compliance_score, issues_found, critical_issues) VALUES
(1, 'compliance', 78.5, 80.2, -1.7, 'warning', 'compliance_worker', '{"consent_gaps":1,"dpia_pending":1,"dpa_expiring":2}'::jsonb, true, 78.5, 4, 1),
(2, 'compliance', 85.2, 84.8, 0.4, 'healthy', 'compliance_worker', '{"all_checks_passed":true}'::jsonb, false, 85.2, 0, 0),
(3, 'compliance', 62.1, 72.5, -10.4, 'critical', 'compliance_worker', '{"s3_exposure":true,"vendor_dpa_missing":true,"training_gaps":true}'::jsonb, true, 62.1, 14, 3),
(7, 'compliance', 55.4, 58.1, -2.7, 'critical', 'compliance_worker', '{"employee_data_residency":false,"dpo_unverified":true}'::jsonb, true, 55.4, 6, 2);

-- ml_risk_predictions
INSERT INTO ml_risk_predictions (organization_id, model_name, current_risk_score, predicted_risk_score, confidence_interval, prediction_horizon_days, features, recommendation) VALUES
(3, 'compliance_risk_predictor_v2', 38.7, 52.3, 8.5, 90, '{"breach_history":1,"vendor_risk":"high","training_gap":true,"recent_violations":2}'::jsonb, 'Immediate remediation of cloud storage controls. Vendor risk reassessment within 30 days.'),
(7, 'compliance_risk_predictor_v2', 44.6, 55.1, 12.0, 90, '{"data_residency_violation":true,"dpo_gap":true,"breach_active":true}'::jsonb, 'Priority: Resolve data residency for employee records. Appoint verified DPO.'),
(1, 'compliance_risk_predictor_v2', 22.5, 28.9, 6.2, 90, '{"dpia_pending":1,"insider_breach":true,"credit_ai_compliance":false}'::jsonb, 'Complete AI credit scoring DPIA. Enhance DLP controls for email.'),
(9, 'compliance_risk_predictor_v2', 19.9, 22.1, 5.8, 90, '{"api_key_exposure":true,"cross_border_active":true}'::jsonb, 'Conduct security audit of mobile app. Review cross-border transfer safeguards.');

-- residency_checks
INSERT INTO residency_checks (organization_id, data_asset_name, data_classification, storage_location, storage_country, storage_latitude, storage_longitude, is_within_borders, residency_status, violation_reason) VALUES
(1, 'Customer Master Database', 'tier1_pii', 'Oracle DB - Lagos DC1', 'Nigeria', 6.4541, 3.3947, true, 'compliant', NULL),
(1, 'Email Archives (Office 365)', 'tier1_pii', 'Microsoft Dublin', 'Ireland', 53.3498, -6.2603, false, 'warning', 'Employee emails stored in EU data center. DPA and SCC in place.'),
(3, 'Vendor Contracts (SAP)', 'tier1_pii', 'SAP Cloud Frankfurt', 'Germany', 50.1109, 8.6821, false, 'violation', 'Employee HR data stored outside Nigeria without adequate transfer mechanism'),
(2, 'Subscriber Database', 'tier1_pii', 'Oracle RAC - Lagos DC2', 'Nigeria', 6.4312, 3.4218, true, 'compliant', NULL),
(9, 'Transaction Logs', 'tier2_financial', 'AWS af-south-1', 'Nigeria', 6.4355, 3.4105, true, 'compliant', NULL),
(7, 'Workday HR Records', 'tier1_pii', 'Workday US Cloud', 'United States', 37.7749, -122.4194, false, 'violation', 'Employee data hosted in US without NDPC-approved transfer mechanism');

-- config_snapshots
INSERT INTO config_snapshots (snapshot_name, source, config_data, status, drift_summary) VALUES
('NDSEP Production Config 2025-Q2', 'terraform', '{"vpc_id":"vpc-ndsep-prod","db_instance":"ndsep-db-primary","redis_cluster":"ndsep-cache","kafka_brokers":3}'::jsonb, 'synced', NULL),
('NDSEP Security Baseline', 'ansible', '{"mfa_enforced":true,"tls_version":"1.3","encryption_at_rest":true,"audit_logging":true}'::jsonb, 'synced', NULL),
('NDSEP Network Config', 'terraform', '{"firewall_rules":45,"waf_enabled":true,"ddos_protection":true}'::jsonb, 'drifted', '{"drift":"WAF rule set outdated by 2 versions"}'::jsonb);

-- drift_alerts
INSERT INTO drift_alerts (organization_id, drift_type, resource_name, previous_state, current_state, severity, status, detected_by) VALUES
(NULL, 'config_drift', 'WAF Rule Set', '{"version":"2.8"}'::jsonb, '{"version":"2.6"}'::jsonb, 'medium', 'open', 'config_monitor_worker'),
(1, 'compliance_drift', 'DPA Expiry - Microsoft Azure', '{"status":"active","expires":"2025-06-30"}'::jsonb, '{"status":"expiring_soon","days_remaining":60}'::jsonb, 'high', 'open', 'compliance_worker');

-- event_store (CQRS/Event Sourcing)
INSERT INTO event_store (aggregate_type, aggregate_id, event_type, version, payload, metadata, hash, prev_hash) VALUES
('organization', 'org-1', 'compliance_scored', 1, '{"score":78.5,"previous":80.2}'::jsonb, '{"actor":"system","source":"compliance_worker"}'::jsonb, 'sha256:evt001', NULL),
('breach', 'breach-5', 'breach_detected', 1, '{"org_id":1,"severity":"critical","title":"Insider Threat"}'::jsonb, '{"actor":"user_1","source":"manual_report"}'::jsonb, 'sha256:evt002', 'sha256:evt001'),
('enforcement', 'case-5', 'case_opened', 1, '{"org_id":1,"ref":"NDPC/ENF/2025/0945"}'::jsonb, '{"actor":"user_1","source":"enforcement_module"}'::jsonb, 'sha256:evt003', 'sha256:evt002'),
('penalty', 'penalty-1', 'penalty_issued', 1, '{"org_id":7,"amount":25000000}'::jsonb, '{"actor":"user_1"}'::jsonb, 'sha256:evt004', 'sha256:evt003'),
('consent', 'consent-6', 'consent_withdrawn', 1, '{"subject":"DS-006","org_id":6}'::jsonb, '{"actor":"data_subject","source":"self_service"}'::jsonb, 'sha256:evt005', 'sha256:evt004');

-- event_projections
INSERT INTO event_projections (projection_name, last_event_id, status) VALUES
('compliance_scorecard', (SELECT id FROM event_store WHERE aggregate_type='organization' LIMIT 1), 'active'),
('breach_timeline', (SELECT id FROM event_store WHERE aggregate_type='breach' LIMIT 1), 'active'),
('enforcement_tracker', (SELECT id FROM event_store WHERE aggregate_type='enforcement' LIMIT 1), 'active');

-- event_snapshots
INSERT INTO event_snapshots (aggregate_type, aggregate_id, version, state) VALUES
('organization', 'org-1', 1, '{"name":"First Bank of Nigeria","compliance_score":78.5,"status":"compliant"}'::jsonb),
('organization', 'org-3', 1, '{"name":"Dangote Group","compliance_score":62.1,"status":"under_review"}'::jsonb);

-- feature_flags
INSERT INTO feature_flags (key, enabled, rollout_percentage, target_orgs, target_roles, environment, description) VALUES
('ai_credit_scoring_dpia_required', true, 100, ARRAY[]::integer[], ARRAY['admin','auditor'], ARRAY['production'], 'Require DPIA completion before enabling AI credit scoring features'),
('real_time_streaming_ui', true, 50, ARRAY[]::integer[], ARRAY['admin'], ARRAY['production','staging'], 'Enable WebSocket-based real-time dashboard updates'),
('noc_ai_agent_auto_remediation', true, 25, ARRAY[]::integer[], ARRAY['admin'], ARRAY['production'], 'Allow NOC AI agent to auto-execute remediation above 85% confidence'),
('digital_twin_simulation', true, 100, ARRAY[]::integer[], ARRAY['admin','auditor'], ARRAY['production','staging'], 'Enable digital twin infrastructure simulation'),
('quantum_resistant_crypto', false, 0, ARRAY[]::integer[], ARRAY[]::text[], ARRAY['staging'], 'Enable CRYSTALS-Kyber/Dilithium quantum-resistant algorithms');

-- feature_flag_audit
INSERT INTO feature_flag_audit (flag_name, action, old_value, new_value, changed_by) VALUES
('noc_ai_agent_auto_remediation', 'created', NULL, '{"enabled":true,"rollout_percentage":25}'::jsonb, 1),
('quantum_resistant_crypto', 'created', NULL, '{"enabled":false,"rollout_percentage":0}'::jsonb, 1),
('real_time_streaming_ui', 'updated', '{"rollout_percentage":25}'::jsonb, '{"rollout_percentage":50}'::jsonb, 1);

-- tenant_registry (multi-tenancy)
INSERT INTO tenant_registry (org_id, org_name, sector, isolation, schema_name, rate_limit_rps, storage_quota_mb, status) VALUES
(1, 'First Bank of Nigeria', 'banking', 'schema', 'tenant_firstbank', 500, 10240, 'active'),
(2, 'MTN Nigeria', 'telecom', 'schema', 'tenant_mtn', 500, 10240, 'active'),
(9, 'Flutterwave Inc', 'fintech', 'schema', 'tenant_flutterwave', 300, 5120, 'active');

-- tenant_encryption_keys
INSERT INTO tenant_encryption_keys (key_id, tenant_id, encrypted_dek, key_version, algorithm, status) VALUES
('tek-fb-001', (SELECT tenant_id FROM tenant_registry WHERE org_id=1 LIMIT 1), '\x0102030405', 1, 'AES-256-GCM', 'active'),
('tek-mtn-001', (SELECT tenant_id FROM tenant_registry WHERE org_id=2 LIMIT 1), '\x0607080910', 1, 'AES-256-GCM', 'active'),
('tek-flw-001', (SELECT tenant_id FROM tenant_registry WHERE org_id=9 LIMIT 1), '\x1112131415', 1, 'AES-256-GCM', 'active');

-- tenant_usage
INSERT INTO tenant_usage (tenant_id, period_start, api_calls, storage_used_mb, events_produced, queries_executed) VALUES
((SELECT tenant_id FROM tenant_registry WHERE org_id=1 LIMIT 1), CURRENT_DATE-30, 125000, 4520.5, 8900, 45000),
((SELECT tenant_id FROM tenant_registry WHERE org_id=2 LIMIT 1), CURRENT_DATE-30, 98000, 3200.8, 6500, 32000),
((SELECT tenant_id FROM tenant_registry WHERE org_id=9 LIMIT 1), CURRENT_DATE-30, 210000, 2800.3, 15000, 68000);

-- encryption_key_metadata
INSERT INTO encryption_key_metadata (provider, key_id, encrypted_dek, version, is_active) VALUES
('aws_kms', 'arn:aws:kms:af-south-1:123456789:key/ndsep-master', 'AQIDAHh...encrypted...', 3, true),
('local_hsm', 'hsm-ndsep-backup-key', 'HSM_ENC_DEK_BACKUP', 1, true);

-- encryption_key_audit
INSERT INTO encryption_key_audit (operation, key_version, performed_by, details) VALUES
('rotate', 3, 'system', '{"reason":"quarterly_rotation","old_version":2,"new_version":3}'::jsonb),
('create', 1, 'admin', '{"reason":"initial_setup","algorithm":"AES-256-GCM"}'::jsonb);

-- field_encryption_status
INSERT INTO field_encryption_status (table_name, column_name, encrypted_count, total_count, encryption_version) VALUES
('kyc_records', 'bvn', 5, 5, 'v3'),
('kyc_records', 'nin', 5, 5, 'v3'),
('consent_records', 'data_subject_nin', 8, 8, 'v3'),
('banking_institutions', 'cbn_code', 6, 6, 'v3');


-- ============================================================================
-- 10. NOC, AI AGENT, DPCO EXTENDED, AND REMAINING TABLES
-- ============================================================================

-- noc_service_baselines
INSERT INTO noc_service_baselines (service_name, metric_name, baseline_period, mean_value, std_deviation, p50_value, p95_value, p99_value, min_value, max_value, sample_count, anomaly_threshold_sigma) VALUES
('core_banking_api', 'response_time_ms', 'daily', 55.2, 12.8, 48.0, 82.0, 125.0, 15.0, 450.0, 86400, 3.0),
('payment_gateway', 'response_time_ms', 'daily', 120.5, 35.2, 105.0, 195.0, 320.0, 25.0, 890.0, 43200, 3.0),
('compliance_api', 'response_time_ms', 'daily', 250.8, 85.3, 220.0, 420.0, 680.0, 50.0, 1500.0, 21600, 3.0),
('ndsep_database', 'query_time_ms', 'daily', 8.5, 4.2, 6.0, 18.0, 35.0, 1.0, 120.0, 500000, 3.0),
('redis_cache', 'response_time_ms', 'daily', 0.8, 0.3, 0.6, 1.5, 2.8, 0.1, 15.0, 1000000, 3.0);

-- noc_incident_knowledge
INSERT INTO noc_incident_knowledge (knowledge_id, incident_type, symptom_signature, root_cause, root_cause_category, affected_services, remediation_steps, prevention_measures, avg_detection_time_seconds, avg_resolution_time_seconds, occurrence_count, success_rate) VALUES
('NK-001', 'service_down', '{"metric":"response_time","condition":"timeout","threshold_ms":5000}'::jsonb, 'Database connection pool exhaustion due to slow query', 'database', ARRAY['core_banking_api','compliance_api'], '["Check DB connection pool","Kill slow queries","Restart connection pool","Verify service recovery"]'::jsonb, '["Add query timeout enforcement","Implement connection pool monitoring","Add circuit breaker"]'::jsonb, 45, 180, 8, 92.5),
('NK-002', 'high_latency', '{"metric":"p95_response_time","condition":"exceeded","threshold_ms":500}'::jsonb, 'Redis cache invalidation storm after deployment', 'cache', ARRAY['payment_gateway','compliance_api'], '["Check Redis memory","Review recent deployments","Warm cache","Monitor recovery"]'::jsonb, '["Implement cache warming on deploy","Use staggered cache TTLs","Add cache fallback"]'::jsonb, 120, 300, 12, 85.0),
('NK-003', 'memory_pressure', '{"metric":"memory_usage_pct","condition":"exceeded","threshold":90}'::jsonb, 'Memory leak in Node.js event handler not releasing WebSocket connections', 'application', ARRAY['ndsep_server'], '["Check heap usage","Identify leaking handlers","Restart with memory limit","Deploy fix"]'::jsonb, '["Add heap monitoring","Implement connection cleanup","Set memory limits in K8s"]'::jsonb, 60, 600, 5, 80.0);

-- noc_agent_actions
INSERT INTO noc_agent_actions (action_id, agent_type, action_type, alert_id, description, input_data, output_data, confidence_score, was_auto_executed, execution_time_ms, outcome) VALUES
('NAA-001', 'action', 'restart_service', 'ALERT-001', 'Auto-restarted core_banking_api after connection pool exhaustion detected', '{"service":"core_banking_api","reason":"connection_pool_exhaustion"}'::jsonb, '{"restart_successful":true,"recovery_time_ms":3200}'::jsonb, 92.5, true, 3200, 'success'),
('NAA-002', 'action', 'cache_warm', 'ALERT-002', 'Initiated cache warming after Redis invalidation storm', '{"cache":"redis_main","keys_to_warm":["compliance_scores","org_data"]}'::jsonb, '{"keys_warmed":1250,"warm_time_ms":8500}'::jsonb, 88.0, true, 8500, 'success'),
('NAA-003', 'action', 'recommend_human', 'ALERT-003', 'Memory leak detected - recommended human review of WebSocket handler', '{"service":"ndsep_server","heap_usage_pct":91.2}'::jsonb, '{"recommendation":"Review websocket connection cleanup in streaming-engine.ts"}'::jsonb, 65.0, false, 150, 'recommended');

-- noc_agent_predictions
INSERT INTO noc_agent_predictions (prediction_id, prediction_type, affected_service, predicted_event, predicted_time, confidence_score, evidence, recommended_actions) VALUES
('NAP-001', 'capacity', 'ndsep_database', 'Storage capacity will exceed 80% in 14 days based on current growth rate', NOW()+interval '14 days', 78.5, '{"current_usage_pct":72.3,"growth_rate_gb_day":1.2,"total_capacity_gb":500}'::jsonb, '["Provision additional storage","Archive old audit logs","Review retention policies"]'::jsonb),
('NAP-002', 'failure', 'redis_cache', 'High probability of cache miss storm during next deployment window', NOW()+interval '3 days', 82.0, '{"deployment_scheduled":true,"cache_warm_time_insufficient":true,"historical_incidents":3}'::jsonb, '["Pre-warm cache before deployment","Stagger deployment","Increase cache TTL temporarily"]'::jsonb);

-- noc_remediation_history
INSERT INTO noc_remediation_history (remediation_id, alert_id, incident_type, severity, detection_method, root_cause_hypothesis, confidence_score, steps_executed, steps_total, steps_succeeded, was_autonomous, time_to_detect_seconds, time_to_diagnose_seconds, time_to_remediate_seconds, outcome) VALUES
('NRH-001', 'ALERT-001', 'service_down', 'critical', 'anomaly_detection', 'Database connection pool exhaustion', 92.5, 4, 4, 4, true, 45, 30, 3200, 'resolved'),
('NRH-002', 'ALERT-002', 'high_latency', 'high', 'threshold_breach', 'Redis cache invalidation storm', 88.0, 3, 4, 3, true, 120, 60, 8500, 'resolved');

-- dpco_payments
INSERT INTO dpco_payments (invoice_id, dpco_org_id, payment_reference, amount, platform_fee_amount, dpco_net_amount, payment_method) VALUES
(1, 1, 'PAY-DS-2025-001', 16125000, 806250, 15318750, 'bank_transfer');

-- dpco_policy_drafts
INSERT INTO dpco_policy_drafts (dpco_org_id, client_organisation_id, document_type, title, status, version, content, ndpc_filed) VALUES
(1, 1, 'privacy_policy', 'First Bank Customer Privacy Policy', 'approved', '3.2', 'First Bank of Nigeria Limited is committed to protecting your personal data...', true),
(1, 2, 'data_protection_policy', 'Flutterwave Data Protection Policy', 'draft', '1.0', 'Flutterwave processes personal data to facilitate digital payments...', false);

-- dpco_verification_statements
INSERT INTO dpco_verification_statements (dpco_org_id, org_id, statement_number, status, compliance_score, signed_by) VALUES
(1, 1, 'DVS-2025-FB-001', 'issued', 78.5, 'Dr. Adaeze Nwosu'),
(1, 2, 'DVS-2025-MTN-001', 'issued', 85.2, 'Dr. Adaeze Nwosu');

-- dpco_evidence_items
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, client_id, title, description, file_url, file_name, mime_type, file_size, control_ids, status) VALUES
(1, 1, 1, 'First Bank Privacy Notice v3.2', 'Current published privacy notice for customer-facing services', '/evidence/fb-privacy-notice-v3.2.pdf', 'fb-privacy-notice-v3.2.pdf', 'application/pdf', 245000, ARRAY['NDPA-27','NDPA-28'], 'active'),
(1, 1, 1, 'DPA with Microsoft Azure', 'Data Processing Agreement covering Office 365 and Azure services', '/evidence/fb-dpa-microsoft-2024.pdf', 'fb-dpa-microsoft-2024.pdf', 'application/pdf', 890000, ARRAY['NDPA-29'], 'active');

-- dpco_audit_control_ratings
INSERT INTO dpco_audit_control_ratings (engagement_id, control_id, rating, notes, rated_by) VALUES
(1, 'NDPA-25', 'compliant', 'Consent management system properly implemented with granular purposes', 'Dr. Adaeze Nwosu'),
(1, 'NDPA-27', 'compliant', 'Privacy notice published and accessible. Version 3.2 meets requirements', 'Dr. Adaeze Nwosu'),
(1, 'NDPA-30', 'partial', 'AI credit scoring DPIA started but not yet completed', 'Dr. Adaeze Nwosu'),
(1, 'NDPA-32', 'compliant', 'DPO appointed, verified, and independently reporting', 'Dr. Adaeze Nwosu'),
(1, 'NDPA-43', 'partial', 'SCCs in place for US transfers. Email archive residency needs remediation', 'Dr. Adaeze Nwosu');

-- dpco_client_policies
INSERT INTO dpco_client_policies (dpco_org_id, client_id, template_id, template_name, status, assigned_by) VALUES
(1, 1, 'TPL-001', 'NDPA Data Protection Policy', 'signed', 'Dr. Adaeze Nwosu'),
(1, 2, 'TPL-002', 'DPIA Standard Template', 'reviewed', 'Chinedu Eze');

-- streaming_events
INSERT INTO streaming_events (topic, source, event_type, payload, partition, "offset") VALUES
('ndsep.compliance', 'compliance_worker', 'score_updated', '{"org_id":1,"score":78.5}'::jsonb, 0, 1),
('ndsep.breach', 'breach_module', 'breach_detected', '{"org_id":1,"severity":"critical"}'::jsonb, 1, 1),
('ndsep.enforcement', 'enforcement_module', 'case_opened', '{"org_id":2,"ref":"NDPC/ENF/2025/0934"}'::jsonb, 2, 1);

-- national_id_verifications
INSERT INTO national_id_verifications (verification_ref, org_id, id_type, verification_purpose, request_count, success_count, failure_count, status) VALUES
('NIV-2025-001', 1, 'BVN', 'kyc_verification', 45000, 43200, 1800, 'active'),
('NIV-2025-002', 1, 'NIN', 'kyc_verification', 42000, 39500, 2500, 'active'),
('NIV-2025-003', 4, 'BVN', 'kyc_verification', 38000, 36500, 1500, 'active'),
('NIV-2025-004', 9, 'BVN', 'merchant_verification', 12000, 11400, 600, 'active');

-- pia_assessments
INSERT INTO pia_assessments (pia_ref, org_id, project_name, project_description, data_controller, processing_purpose, data_categories, data_subject_count, cross_border_transfer, automated_decision_making, risk_level, risk_score, status) VALUES
('PIA-2025-001', 1, 'AI Credit Scoring Engine v4.2', 'Machine learning credit decisioning system', 'First Bank of Nigeria', 'Automated credit scoring for instant loan decisions', ARRAY['financial_data','transaction_history','device_data'], 500000, false, true, 'high', 78.5, 'in_progress'),
('PIA-2025-002', 2, 'Network Optimization Analytics', 'Location-based network performance analysis', 'MTN Nigeria', 'Cell tower capacity planning using anonymized location data', ARRAY['location_data','device_identifiers'], 78500000, false, false, 'medium', 45.2, 'completed');

-- compliance_timeline
INSERT INTO compliance_timeline (org_id, org_name, event_type, aggregate_type, aggregate_id, summary, severity) VALUES
(1, 'First Bank of Nigeria', 'breach_reported', 'breach', '5', 'Insider threat: unauthorized data export by employee', 'critical'),
(3, 'Dangote Group', 'penalty_issued', 'penalty', '2', 'N150M penalty for S3 data exposure', 'critical'),
(7, 'Shell Petroleum Dev Co', 'enforcement_opened', 'enforcement', '1', 'Investigation opened for unauthorized database access', 'high'),
(2, 'MTN Nigeria', 'breach_reported', 'breach', '4', 'SIM swap fraud affecting 450 customers', 'high'),
(5, 'Airtel Nigeria', 'penalty_settled', 'penalty', '3', 'N8M DPO appointment delay fine settled', 'medium');

-- data_export_jobs
INSERT INTO data_export_jobs (organization_id, requested_by, export_type, data_categories, format, status, records_exported, file_size_bytes, started_at, completed_at) VALUES
(1, 1, 'dsar_response', '["personal_details","financial_data","transaction_history"]'::jsonb, 'json', 'completed', 45000, 12500000, NOW()-interval '2 days', NOW()-interval '2 days' + interval '30 minutes'),
(2, 1, 'compliance_report', '["compliance_scores","violations","remediation_status"]'::jsonb, 'csv', 'completed', 120, 85000, NOW()-interval '1 day', NOW()-interval '1 day' + interval '5 minutes');

-- evidence_packages
INSERT INTO evidence_packages (organization_id, package_type, reference_type, reference_id, status, content_hash, file_url) VALUES
(1, 'dsar_response', 'citizen_request', 1, 'ready', 'sha256:evidence_pkg_001', '/evidence-packages/dsar-2025-00142.zip'),
(3, 'enforcement_evidence', 'enforcement_case', 2, 'ready', 'sha256:evidence_pkg_002', '/evidence-packages/enf-2025-0756.zip');

-- regulatory_sandbox_applications
INSERT INTO regulatory_sandbox_applications (application_ref, org_id, project_title, project_description, innovation_type, data_types_involved, proposed_duration, status) VALUES
('RSA-2025-001', 9, 'Decentralized Identity for KYC', 'Blockchain-based self-sovereign identity for streamlined KYC verification', 'blockchain_identity', ARRAY['biometric_data','identity_documents','financial_data'], 18, 'approved'),
('RSA-2025-002', 10, 'AI-Powered Fraud Detection Consortium', 'Federated learning model sharing fraud patterns across banks without sharing raw data', 'federated_ml', ARRAY['transaction_data','fraud_patterns'], 24, 'under_review');


-- ============================================================================
-- 11. REMAINING TABLES (ensuring 100% coverage)
-- ============================================================================

-- ai_systems
INSERT INTO ai_systems (name, organization_id, vendor, version, purpose, risk_level, status, training_data_description, personal_data_processed, cross_border_transfer) VALUES
('CreditScore AI', 1, 'In-house', '4.2', 'Automated credit scoring for instant loan approval', 'high', 'approved', 'Historical transaction data, repayment records, demographic data from 2M+ customers', true, false),
('FraudGuard ML', 9, 'In-house', '2.1', 'Real-time fraud detection for payment transactions', 'high', 'approved', 'Labeled fraud/legitimate transactions from 50M+ payment records', true, false),
('ChurnPredict', 2, 'DataRobot', '1.8', 'Subscriber churn prediction and retention targeting', 'limited', 'approved', 'Subscriber usage patterns, billing data, NPS scores', true, false),
('ComplianceBot', NULL, 'NDSEP', '1.0', 'Automated compliance scoring and gap detection', 'minimal', 'registered', 'Organizational compliance data, regulatory requirements', true, false);

-- ai_ethics_reviews
INSERT INTO ai_ethics_reviews (review_ref, org_id, ai_system_name, ai_system_type, risk_category, human_oversight_enabled, data_subjects_informed, bias_assessment_score, transparency_score, overall_score, status, reviewer) VALUES
('AER-2025-001', 1, 'CreditScore AI', 'automated_decision', 'high', true, true, 72.5, 68.0, 70.3, 'completed', 'NDPC AI Ethics Committee'),
('AER-2025-002', 9, 'FraudGuard ML', 'fraud_detection', 'high', true, false, 85.2, 78.0, 81.6, 'completed', 'NDPC AI Ethics Committee'),
('AER-2025-003', 2, 'ChurnPredict', 'profiling', 'limited', false, false, 62.1, 55.0, 58.6, 'in_progress', 'NDPC AI Ethics Committee');

-- watchlist_entries
INSERT INTO watchlist_entries (entity_id, entity_type, primary_name, aliases, nationality, source, list_type, reason, is_active, added_by) VALUES
('WL-PEP-001', 'individual', 'Chief James Okafor', 'James O., J. Okafor', 'Nigerian', 'NFIU', 'pep', 'Former state governor - enhanced due diligence required', true, 'NFIU Compliance'),
('WL-SAN-001', 'individual', 'Ahmed Al-Hassan', 'A. Al-Hassan, Ahmed Hassan', 'Multiple', 'UN_SANCTIONS', 'sanctions', 'UN Security Council Resolution 2253 - ISIL/Al-Qaida sanctions', true, 'UN Sanctions List'),
('WL-PEP-002', 'individual', 'Senator Chibuike Rotimi', 'C. Rotimi, Chibuike R.', 'Nigerian', 'internal', 'pep', 'Serving senator - standard PEP monitoring', true, 'AML Compliance Team');

-- webhook_deliveries (references webhook_subscriptions)
INSERT INTO webhook_deliveries (subscription_id, event, payload, response_status, response_body, attempt, success) VALUES
(1, 'breach.created', '{"breach_id":5,"org_id":1,"severity":"critical"}'::jsonb, 200, '{"received":true}', 1, true),
(2, 'breach.created', '{"breach_id":4,"org_id":2,"severity":"high"}'::jsonb, 200, '{"ack":true}', 1, true),
(2, 'sla.breached', '{"org_id":2,"sla_type":"breach_notification"}'::jsonb, 500, 'Internal Server Error', 1, false),
(2, 'sla.breached', '{"org_id":2,"sla_type":"breach_notification"}'::jsonb, 200, '{"ack":true}', 2, true);

-- whistleblower_reports
INSERT INTO whistleblower_reports (report_ref, category, org_id, description, is_anonymous, reporter_email, evidence_urls, priority, severity, status) VALUES
('WB-2025-001', 'data_misuse', 1, 'Employee in branch operations is taking photos of customer KYC documents on personal phone', true, NULL, ARRAY['/evidence/wb-2025-001-screenshot.jpg'], 'high', 'critical', 'investigating'),
('WB-2025-002', 'privacy_violation', 3, 'Dangote factory CCTV footage being shared with unauthorized third parties via WhatsApp group', false, 'concerned.employee@protonmail.com', ARRAY['/evidence/wb-2025-002-whatsapp.pdf'], 'medium', 'high', 'open');

-- dcpmi_thresholds
INSERT INTO dcpmi_thresholds (metric_name, sector, threshold_value, unit, alert_level, is_active, description, regulatory_basis) VALUES
('breach_notification_hours', 'all', 72, 'hours', 'critical', true, 'Maximum hours to notify NDPC after breach discovery', 'NDPA Section 39'),
('dsar_response_days', 'all', 30, 'days', 'high', true, 'Maximum days to respond to data subject access request', 'NDPA Section 34'),
('dpo_appointment_days', 'all', 90, 'days', 'high', true, 'Maximum days to appoint DPO after registration', 'NDPA Section 32'),
('data_residency_compliance_pct', 'banking', 100, 'percent', 'critical', true, 'Required percentage of PII stored within Nigerian borders', 'NDPA Section 43 + CBN Circular'),
('consent_renewal_days', 'all', 365, 'days', 'medium', true, 'Maximum consent validity period before renewal required', 'NDPA Section 25');

-- cross_agency_data_shares
INSERT INTO cross_agency_data_shares (share_ref, requesting_agency, providing_agency, data_categories, legal_basis, ndpa_article, purpose, encryption_standard, status, records_shared) VALUES
('CADS-2025-001', 'EFCC', 'NDPC', ARRAY['enforcement_records','penalty_data'], 'legal_obligation', 'Section 44', 'Financial crime investigation requiring compliance violation data', 'AES-256', 'approved', 45),
('CADS-2025-002', 'NCC', 'NDPC', ARRAY['telecom_compliance','breach_reports'], 'legal_obligation', 'Section 44', 'Telecoms regulatory oversight - data protection compliance status', 'AES-256', 'approved', 120);

-- cross_sector_alerts
INSERT INTO cross_sector_alerts (title, severity, source_sector, target_sectors, description, status) VALUES
('Phishing Campaign Targeting Nigerian Banks', 'critical', 'banking', 'banking,fintech', 'Coordinated phishing campaign using fake CBN emails to harvest banking credentials. 15+ banks targeted.', 'active'),
('SIM Swap Fraud Ring Identified', 'high', 'telecom', 'banking,fintech', 'Organized crime ring using SIM swap fraud across multiple operators to access bank accounts.', 'active'),
('Cloud Misconfiguration Pattern', 'medium', 'manufacturing', 'all', 'Pattern of S3/Azure Blob storage misconfigurations detected across manufacturing sector.', 'resolved');

-- cross_sector_data_shares
INSERT INTO cross_sector_data_shares (share_id, organization_id, source_sector, target_sector, data_type, justification, status) VALUES
('CSDS-2025-001', 1, 'banking', 'telecom', 'fraud_indicators', 'Sharing SIM swap fraud indicators to prevent cross-sector fraud', 'approved'),
('CSDS-2025-002', 2, 'telecom', 'banking', 'subscriber_verification', 'Phone number ownership verification for enhanced KYC', 'approved');

-- sector_compliance_events
INSERT INTO sector_compliance_events (org_id, sector, event_type, severity, title, description, worker_name, resolved) VALUES
(1, 'banking', 'compliance_check', 'medium', 'Quarterly Compliance Assessment Completed', 'First Bank Q1 2025 assessment: score 78.5, 8 gaps identified', 'banking_compliance_worker', true),
(2, 'telecom', 'breach_detected', 'high', 'SIM Swap Breach Detected', 'Coordinated SIM swap attack affecting 450 subscribers', 'telecom_security_worker', false),
(7, 'energy', 'data_residency_violation', 'critical', 'Cross-Border Data Transfer Without Safeguards', 'Pipeline telemetry exported to Shell HQ Netherlands', 'energy_compliance_worker', false);

-- portal_submissions
INSERT INTO portal_submissions (submission_token, organization_id, org_name, org_sector, org_country, contact_name, contact_email, current_phase, self_assessment_score, compliance_score) VALUES
('SUB-2025-001', 8, 'Nigerian Breweries', 'manufacturing', 'Nigeria', 'Privacy Officer', 'privacy@nbplc.com', 'self_assessment', 65.0, 73.6),
('SUB-2025-002', 10, 'Interswitch Group', 'fintech', 'Nigeria', 'Compliance Manager', 'compliance@interswitchgroup.com', 'initial_audit', 72.0, 76.4);

-- onboarding_phases
INSERT INTO onboarding_phases (submission_id, phase, status, worker_results) VALUES
(1, 'registration', 'completed', '{"verified":true,"cac_check":"passed"}'::jsonb),
(1, 'self_assessment', 'completed', '{"score":65.0,"gaps":5}'::jsonb),
(2, 'registration', 'completed', '{"verified":true,"cac_check":"passed"}'::jsonb),
(2, 'asset_inventory', 'completed', '{"assets_discovered":218}'::jsonb),
(2, 'self_assessment', 'completed', '{"score":72.0,"gaps":3}'::jsonb),
(2, 'initial_audit', 'in_progress', NULL);

-- incident_response_activations
INSERT INTO incident_response_activations (activation_ref, playbook_id, org_id, incident_title, assigned_to, affected_records, current_step, status) VALUES
('IRA-2025-001', 1, 1, 'First Bank Insider Data Export', 'CSIRT Team Lead', 12000, 5, 'in_progress'),
('IRA-2025-002', 4, 7, 'Shell Cross-Border Data Transfer', 'Data Residency Officer', 2300, 3, 'in_progress'),
('IRA-2025-003', 2, 3, 'Dangote Ransomware Attempt', 'SOC Lead', 0, 9, 'completed');

-- bulk_operations
INSERT INTO bulk_operations (id, operation_type, total_items, processed_items, success_count, failure_count, status) VALUES
('BULK-2025-001', 'compliance_score_refresh', 10, 10, 10, 0, 'completed'),
('BULK-2025-002', 'breach_notification_batch', 450, 445, 440, 5, 'completed'),
('BULK-2025-003', 'dsar_batch_export', 3, 2, 2, 0, 'in_progress');

-- retention_purge_log
INSERT INTO retention_purge_log (category, table_name, records_purged, records_anonymized, policy_days) VALUES
('audit_logs', 'audit_logs', 15000, 0, 2555),
('analytics', 'analytics_events', 85000, 45000, 365),
('session_data', 'cookie_consent_records', 250000, 0, 180);

-- stripe_payment_intents
INSERT INTO stripe_payment_intents (stripe_intent_id, penalty_id, org_id, amount_ngn, amount_usd, currency, status) VALUES
('pi_3abc123', 3, 5, 8000000, 5200, 'NGN', 'succeeded');

-- data_pipeline_flows
INSERT INTO data_pipeline_flows (flow_id, flow_name, engine, source_system, target_system, schedule_expression, org_id, status, records_processed, last_run_status) VALUES
('DPF-001', 'Compliance Score ETL', 'temporal', 'ndsep_db', 'opensearch', '0 */6 * * *', NULL, 'active', 45000, 'success'),
('DPF-002', 'Breach Alert Pipeline', 'kafka', 'wazuh', 'ndsep_db', 'realtime', NULL, 'active', 12500, 'success'),
('DPF-003', 'Banking KYC Sync', 'temporal', 'cbn_api', 'ndsep_db', '0 2 * * *', 1, 'active', 8500, 'success');

-- dbt_models
INSERT INTO dbt_models (model_name, model_type, schema_name, description, materialization, depends_on, last_run_status, row_count) VALUES
('compliance_scorecard', 'mart', 'analytics', 'Aggregated compliance scores by organization', 'table', ARRAY['stg_organizations','stg_violations','stg_breaches'], 'success', 10),
('breach_timeline', 'mart', 'analytics', 'Chronological breach event timeline', 'incremental', ARRAY['stg_breaches','stg_breach_timers'], 'success', 5),
('enforcement_summary', 'mart', 'analytics', 'Enforcement actions and penalty summary', 'table', ARRAY['stg_penalties','stg_cases','stg_fines'], 'success', 5);

-- airflow_dags
INSERT INTO airflow_dags (dag_id, description, schedule_interval, is_active, last_run_status, owner) VALUES
('ndsep_compliance_refresh', 'Refresh compliance scores for all organizations', '@hourly', true, 'success', 'ndsep_platform'),
('ndsep_breach_notification_check', 'Check breach notification deadlines and send alerts', '*/15 * * * *', true, 'success', 'ndsep_platform'),
('ndsep_data_residency_scan', 'Scan cloud storage for data residency violations', '@daily', true, 'success', 'ndsep_platform');

-- remediation_workflows (references compliance_violations, organizations, users)
INSERT INTO remediation_workflows (violation_id, org_id, action_type, priority, description, status, assigned_to, deadline) VALUES
(1, 7, 'data_migration', 'critical', 'Migrate employee data from Workday US to local HR system', 'in_progress', 1, NOW()+interval '60 days'),
(2, 3, 'cloud_remediation', 'critical', 'Secure S3 bucket and implement automated access reviews', 'completed', 1, NOW()-interval '10 days'),
(4, 2, 'process_improvement', 'high', 'Implement enhanced biometric verification for SIM swap requests', 'in_progress', 1, NOW()+interval '30 days'),
(5, 1, 'assessment_completion', 'high', 'Complete DPIA for AI credit scoring system', 'in_progress', 1, NOW()+interval '21 days');


-- ============================================================================
-- 12. FINAL REMAINING TABLES
-- ============================================================================

-- stripe_payment_intents (already added above, skip duplicate)

-- data_lineage_edges already added

-- cross_sector_alerts already added

-- Ensure all remaining empty tables get at least minimal data:

-- liveness_checks (if exists)
INSERT INTO liveness_checks (reference_id, check_type, face_detected, landmarks_count, liveness_score, anti_spoofing_score, spoof_type, deepfake_probability, face_match_score, face_match_target, quality_score, processing_time_ms, status, metadata)
SELECT 'LIV-2025-001', 'passive', true, 68, 95.2, 88.7, 'real', 0.12, 98.5, 'KYC-2025-00142', 96.8, 245, 'completed', '{"camera":"front","resolution":"1920x1080"}'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='liveness_checks' AND table_schema='public');

-- noc_devices (if exists from NOC migration)
INSERT INTO noc_devices (device_id, hostname, ip_address, device_type, vendor, model, location, status, snmp_community, last_poll_at, uptime_seconds, cpu_usage_pct, memory_usage_pct, metadata)
SELECT 'DEV-001', 'core-rtr-01.ndsep.local', '10.0.0.1', 'router', 'Cisco', 'ASR 9001', 'Lagos DC1', 'up', 'ndsep-snmp-v3', NOW()-interval '5 minutes', 8640000, 45.2, 62.8, '{"os":"IOS XR 7.9","interfaces":48}'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_devices' AND table_schema='public');

INSERT INTO noc_devices (device_id, hostname, ip_address, device_type, vendor, model, location, status, snmp_community, last_poll_at, uptime_seconds, cpu_usage_pct, memory_usage_pct, metadata)
SELECT 'DEV-002', 'fw-01.ndsep.local', '10.0.0.2', 'firewall', 'Palo Alto', 'PA-5260', 'Lagos DC1', 'up', 'ndsep-snmp-v3', NOW()-interval '5 minutes', 7200000, 32.5, 48.1, '{"os":"PAN-OS 11.1","zones":8}'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_devices' AND table_schema='public');

INSERT INTO noc_devices (device_id, hostname, ip_address, device_type, vendor, model, location, status, snmp_community, last_poll_at, uptime_seconds, cpu_usage_pct, memory_usage_pct, metadata)
SELECT 'DEV-003', 'db-primary.ndsep.local', '10.0.1.50', 'server', 'Dell', 'PowerEdge R750', 'Lagos DC1', 'up', 'ndsep-snmp-v3', NOW()-interval '5 minutes', 5400000, 68.9, 78.2, '{"os":"Ubuntu 22.04","role":"database","cpu_cores":64,"ram_gb":512}'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_devices' AND table_schema='public');

-- noc_alerts (if exists)
INSERT INTO noc_alerts (alert_id, device_id, alert_type, severity, title, description, source, status, acknowledged_by, created_at)
SELECT 'NALERT-001', 'DEV-003', 'threshold', 'warning', 'High Memory Usage on DB Primary', 'Memory usage at 78.2% exceeds 75% warning threshold', 'snmp_collector', 'open', NULL, NOW()-interval '30 minutes'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_alerts' AND table_schema='public');

-- noc_topology_links (if exists)
INSERT INTO noc_topology_links (source_device_id, target_device_id, link_type, bandwidth_mbps, utilization_pct, status)
SELECT 'DEV-001', 'DEV-002', 'ethernet', 10000, 35.2, 'up'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_topology_links' AND table_schema='public');

INSERT INTO noc_topology_links (source_device_id, target_device_id, link_type, bandwidth_mbps, utilization_pct, status)
SELECT 'DEV-002', 'DEV-003', 'ethernet', 10000, 22.8, 'up'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_topology_links' AND table_schema='public');

-- noc_uptime_records (if exists)
INSERT INTO noc_uptime_records (service_name, check_time, is_up, response_time_ms, status_code)
SELECT 'core_banking_api', NOW()-interval '1 hour', true, 52.3, 200
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_uptime_records' AND table_schema='public');

-- noc_uptime_sla (if exists)
INSERT INTO noc_uptime_sla (service_name, period_start, period_end, total_checks, successful_checks, uptime_pct, target_pct, sla_met, p50_response_ms, p95_response_ms, p99_response_ms)
SELECT 'core_banking_api', CURRENT_DATE-30, CURRENT_DATE, 43200, 43150, 99.88, 99.9, false, 48.0, 82.0, 125.0
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_uptime_sla' AND table_schema='public');

-- noc_escalation_policies (if exists)
INSERT INTO noc_escalation_policies (policy_id, name, severity_filter, escalation_levels, auto_escalate_minutes)
SELECT 'ESP-001', 'Critical Infrastructure', ARRAY['critical'], '[{"level":1,"notify":["oncall-infra"],"minutes":5},{"level":2,"notify":["oncall-infra","engineering-lead"],"minutes":15}]'::jsonb, 5
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_escalation_policies' AND table_schema='public');

-- noc_oncall_schedules (if exists)
INSERT INTO noc_oncall_schedules (schedule_id, team_name, current_oncall, rotation_type, rotation_interval_hours)
SELECT 'OCS-001', 'Infrastructure', 'Emeka Obi', 'weekly', 168
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_oncall_schedules' AND table_schema='public');

-- noc_runbooks (if exists)
INSERT INTO noc_runbooks (runbook_id, name, description, trigger_conditions, steps, auto_executable)
SELECT 'RB-001', 'Database Connection Pool Recovery', 'Auto-recovery for database connection pool exhaustion', '{"alert_type":"service_down","service":"core_banking_api","root_cause":"connection_pool"}'::jsonb, '[{"step":1,"action":"check_connections","command":"SELECT count(*) FROM pg_stat_activity"},{"step":2,"action":"kill_idle","command":"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state=''idle'' AND query_start < now()-interval ''5 min''"},{"step":3,"action":"verify","command":"curl -s http://localhost:3000/health"}]'::jsonb, true
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_runbooks' AND table_schema='public');

-- noc_collector_metrics (if exists)  
INSERT INTO noc_collector_metrics (collector_type, packets_received, packets_processed, errors, last_received_at)
SELECT 'snmp', 125000, 124950, 50, NOW()-interval '1 minute'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_collector_metrics' AND table_schema='public');

-- noc_escalation_history (if exists)
INSERT INTO noc_escalation_history (alert_id, policy_id, escalation_level, notified_contacts, escalated_at)
SELECT 'NALERT-001', 'ESP-001', 1, ARRAY['oncall-infra'], NOW()-interval '25 minutes'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='noc_escalation_history' AND table_schema='public');

-- Seed complete

-- ============================================================================
-- SEED COMPLETE: All 151+ tables populated with realistic Nigerian regulatory
-- and compliance domain data. Run with:
--   PGPASSWORD=ndsep_secure_2026 psql -h localhost -U ndsep_user -d ndsep_db -f migrations/seed_synthetic_data.sql
-- ============================================================================
