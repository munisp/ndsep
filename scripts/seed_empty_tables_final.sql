-- Seed fintech_companies (correct column names)
INSERT INTO fintech_companies (organization_id, company_name, cbn_licence_number, sec_licence_number, licence_type, status, active_users, monthly_transaction_volume_ngn, data_localisation_compliant, sandbox_mode, api_gateway_url, data_storage_country, licence_expires_at, last_cbn_audit, is_active, created_at, updated_at) VALUES
(10, 'Flutterwave Technology Solutions', 'CBN/PSSP/2019/001', 'SEC/2019/001', 'payment_solution_service', 'active', 15000000, 500000000000, true, false, 'https://api.flutterwave.com', 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '6 months', true, NOW(), NOW()),
(9, 'Paystack Payments Limited', 'CBN/PSSP/2019/002', NULL, 'payment_solution_service', 'active', 8000000, 300000000000, true, false, 'https://api.paystack.co', 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '8 months', true, NOW(), NOW()),
(3, 'Interswitch Limited', 'CBN/PSSP/2007/001', 'SEC/2007/001', 'switching_company', 'active', 25000000, 800000000000, true, false, 'https://api.interswitchgroup.com', 'Nigeria', NOW() + INTERVAL '1 year', NOW() - INTERVAL '3 months', true, NOW(), NOW()),
(8, 'OPay Digital Services Limited', 'CBN/MMO/2019/001', NULL, 'mobile_money', 'active', 35000000, 200000000000, true, false, 'https://api.opayweb.com', 'Nigeria', NOW() + INTERVAL '18 months', NOW() - INTERVAL '12 months', true, NOW(), NOW()),
(2, 'PalmPay Limited', 'CBN/MMO/2019/002', NULL, 'mobile_money', 'active', 30000000, 180000000000, false, false, 'https://api.palmpay.com', 'China', NOW() + INTERVAL '18 months', NOW() - INTERVAL '15 months', true, NOW(), NOW()),
(10, 'Kuda Microfinance Bank', 'CBN/MFB/2019/001', NULL, 'microfinance_bank', 'active', 5000000, 50000000000, true, false, 'https://api.kuda.com', 'Nigeria', NOW() + INTERVAL '3 years', NOW() - INTERVAL '4 months', true, NOW(), NOW()),
(9, 'Carbon (OneFi)', 'CBN/PSSP/2016/001', NULL, 'payment_solution_service', 'active', 2000000, 30000000000, true, false, 'https://api.getcarbon.co', 'Nigeria', NOW() + INTERVAL '1 year', NOW() - INTERVAL '10 months', true, NOW(), NOW()),
(3, 'Chipper Cash', 'CBN/PSSP/2020/001', NULL, 'payment_solution_service', 'suspended', 1500000, 20000000000, false, false, 'https://api.chippercash.com', 'United States', NOW() + INTERVAL '6 months', NOW() - INTERVAL '18 months', false, NOW(), NOW()),
(8, 'TeamApt (Moniepoint)', 'CBN/PSSP/2018/001', NULL, 'payment_solution_service', 'active', 12000000, 150000000000, true, false, 'https://api.moniepoint.com', 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '5 months', true, NOW(), NOW()),
(2, 'Cowrywise Financial Technology', 'CBN/PSSP/2017/001', 'SEC/2017/001', 'robo_advisor', 'active', 800000, 10000000000, true, true, 'https://api.cowrywise.com', 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '7 months', true, NOW(), NOW());

-- Seed fintech_data_events (correct column names)
INSERT INTO fintech_data_events (event_ref, company_id, event_type, data_category, records_affected, source_country, destination_country, is_localised, violation_detected, violation_details, regulatory_notified, penalty_ngn, status, occurred_at, resolved_at, created_at, updated_at) VALUES
('FDE-2024-001', 1, 'customer_data_transfer', 'tier1_pii', 15000, 'Nigeria', 'United Kingdom', false, true, 'Customer PII transferred to UK data centre without CBN approval or NDPC notification', true, 50000000, 'investigating', NOW() - INTERVAL '5 days', NULL, NOW() - INTERVAL '5 days', NOW()),
('FDE-2024-002', 2, 'cross_border_payment', 'tier2_financial', 50000, 'Nigeria', 'United States', false, true, 'Transaction data routed through US payment processor without data localisation compliance', true, 25000000, 'open', NOW() - INTERVAL '10 days', NULL, NOW() - INTERVAL '10 days', NOW()),
('FDE-2024-003', 3, 'transaction_data_export', 'tier2_financial', 200000, 'Nigeria', 'United States', false, true, 'Transaction logs stored on AWS US-East servers in violation of CBN data localisation directive', true, 100000000, 'resolved', NOW() - INTERVAL '30 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '30 days', NOW()),
('FDE-2024-004', 4, 'kyc_data_sharing', 'tier1_pii', 8000, 'Nigeria', 'Nigeria', true, false, 'KYC data shared with licensed Nigerian DPCO for compliance audit', false, 0, 'resolved', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '3 days', NOW()),
('FDE-2024-005', 5, 'data_breach', 'tier1_pii', 2500, 'Nigeria', 'China', false, true, 'Mobile app vulnerability exposed user account data to parent company servers in China', true, 75000000, 'investigating', NOW() - INTERVAL '2 days', NULL, NOW() - INTERVAL '2 days', NOW()),
('FDE-2024-006', 6, 'credit_data_export', 'tier2_financial', 30000, 'Nigeria', 'United Kingdom', false, true, 'Credit scoring data shared with UK parent company without NDPC transfer approval', true, 40000000, 'resolved', NOW() - INTERVAL '45 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '45 days', NOW()),
('FDE-2024-007', 7, 'transaction_data_export', 'tier2_financial', 12000, 'Nigeria', 'United States', false, true, 'Loan application data stored on Google Cloud US without data localisation compliance', false, 30000000, 'open', NOW() - INTERVAL '7 days', NULL, NOW() - INTERVAL '7 days', NOW()),
('FDE-2024-008', 8, 'fraud_data_sharing', 'tier1_pii', 5000, 'Nigeria', 'United States', false, true, 'Fraud detection data shared with US-based third party without consent', false, 20000000, 'investigating', NOW() - INTERVAL '1 day', NULL, NOW() - INTERVAL '1 day', NOW()),
('FDE-2024-009', 9, 'regulatory_reporting', 'tier2_financial', 0, 'Nigeria', 'Nigeria', true, false, 'Quarterly CBN regulatory report submitted via approved secure channel', false, 0, 'resolved', NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days', NOW() - INTERVAL '15 days', NOW()),
('FDE-2024-010', 10, 'transaction_data_export', 'tier2_financial', 45000, 'Nigeria', 'Ireland', false, true, 'Investment portfolio data replicated to EU data centre without NDPC approval', true, 35000000, 'open', NOW() - INTERVAL '4 days', NULL, NOW() - INTERVAL '4 days', NOW());

-- Seed insurance_companies (correct column names)
INSERT INTO insurance_companies (organization_id, company_name, naicom_licence_number, licence_type, status, policy_count, gross_premium_ngn, claims_ratio, solvency_ratio, data_localisation_compliant, ndpc_registered, policyholder_data_country, licence_expires_at, last_naicom_audit, is_active, created_at, updated_at) VALUES
(10, 'AIICO Insurance Plc', 'NAICOM/LIC/2001/001', 'composite', 'active', 250000, 45000000000, 0.62, 1.45, true, true, 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '6 months', true, NOW(), NOW()),
(9, 'Leadway Assurance Company Limited', 'NAICOM/LIC/2001/002', 'composite', 'active', 180000, 38000000000, 0.58, 1.52, true, true, 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '4 months', true, NOW(), NOW()),
(3, 'AXA Mansard Insurance Plc', 'NAICOM/LIC/2001/003', 'composite', 'active', 120000, 28000000000, 0.71, 1.38, false, true, 'France', NOW() + INTERVAL '18 months', NOW() - INTERVAL '8 months', true, NOW(), NOW()),
(8, 'Custodian Investment Plc', 'NAICOM/LIC/2001/004', 'life', 'active', 85000, 15000000000, 0.45, 1.65, false, false, 'Nigeria', NOW() + INTERVAL '3 years', NOW() - INTERVAL '12 months', true, NOW(), NOW()),
(2, 'NEM Insurance Plc', 'NAICOM/LIC/2001/005', 'non_life', 'active', 95000, 12000000000, 0.68, 1.42, true, true, 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '5 months', true, NOW(), NOW()),
(10, 'Coronation Insurance Plc', 'NAICOM/LIC/2001/006', 'composite', 'active', 60000, 9000000000, 0.55, 1.58, true, true, 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '7 months', true, NOW(), NOW()),
(9, 'Sovereign Trust Insurance Plc', 'NAICOM/LIC/2001/007', 'non_life', 'suspended', 45000, 6000000000, 0.82, 1.15, false, false, 'Nigeria', NOW() + INTERVAL '6 months', NOW() - INTERVAL '18 months', false, NOW(), NOW()),
(3, 'Mutual Benefits Assurance Plc', 'NAICOM/LIC/2001/008', 'composite', 'active', 75000, 11000000000, 0.61, 1.48, true, true, 'Nigeria', NOW() + INTERVAL '2 years', NOW() - INTERVAL '9 months', true, NOW(), NOW());

-- Seed insurance_policies (correct column names)
INSERT INTO insurance_policies (policy_ref, company_id, policy_type, policyholder_name, policyholder_nin, sum_insured_ngn, annual_premium_ngn, status, data_storage_country, cross_border_reinsurance, reinsurance_country, start_date, end_date, created_at, updated_at) VALUES
('AIICO/LIFE/2024/001', 1, 'life', 'Dangote Industries Limited', '12345678901', 500000000, 5000000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('LWY/COMP/2024/001', 2, 'comprehensive', 'MTN Nigeria Communications Plc', '23456789012', 1200000000, 12000000, 'active', 'Nigeria', true, 'United Kingdom', NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('AXA/HLTH/2024/001', 3, 'health', 'Zenith Bank Plc', '34567890123', 800000000, 8000000, 'active', 'France', true, 'France', NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('CUS/LIFE/2024/001', 4, 'life', 'Access Bank Plc', '45678901234', 300000000, 3000000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('NEM/PROP/2024/001', 5, 'property', 'Nigerian National Petroleum Corporation', '56789012345', 2500000000, 25000000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('COR/LIAB/2024/001', 6, 'liability', 'Guaranty Trust Holding Company', '67890123456', 400000000, 4000000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('SOV/AUTO/2024/001', 7, 'auto', 'First Bank of Nigeria Limited', '78901234567', 150000000, 1500000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('MUT/COMP/2024/001', 8, 'comprehensive', 'United Bank for Africa Plc', '89012345678', 600000000, 6000000, 'active', 'Nigeria', true, 'Germany', NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '90 days', NOW()),
('AIICO/HLTH/2024/002', 1, 'health', 'Stanbic IBTC Bank Plc', '90123456789', 200000000, 2000000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '60 days', NOW() + INTERVAL '305 days', NOW() - INTERVAL '60 days', NOW()),
('LWY/LIFE/2024/002', 2, 'life', 'Ecobank Nigeria Limited', '01234567890', 350000000, 3500000, 'active', 'Nigeria', false, NULL, NOW() - INTERVAL '60 days', NOW() + INTERVAL '305 days', NOW() - INTERVAL '60 days', NOW());

-- Seed insurance_claims (correct column names)
INSERT INTO insurance_claims (claim_ref, policy_id, company_id, claim_type, claim_amount_ngn, approved_amount_ngn, status, fraud_flag, fraud_score, data_breach_risk, submitted_at, settled_at, notes, created_at, updated_at) VALUES
('CLM/2024/001', 1, 1, 'life', 250000000, 250000000, 'settled', false, 0.05, false, NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 days', 'Valid life insurance claim. All documentation verified.', NOW() - INTERVAL '30 days', NOW()),
('CLM/2024/002', 2, 2, 'comprehensive', 85000000, 72000000, 'approved', false, 0.12, false, NOW() - INTERVAL '20 days', NULL, 'Partial approval due to policy excess deduction.', NOW() - INTERVAL '20 days', NOW()),
('CLM/2024/003', 3, 3, 'health', 35000000, 0, 'under_investigation', false, 0.45, true, NOW() - INTERVAL '10 days', NULL, 'Data handling compliance issue detected. NDPC notification required.', NOW() - INTERVAL '10 days', NOW()),
('CLM/2024/004', 5, 5, 'property', 1500000000, 1200000000, 'approved', false, 0.08, false, NOW() - INTERVAL '45 days', NULL, 'Large property claim under review. Partial approval pending final assessment.', NOW() - INTERVAL '45 days', NOW()),
('CLM/2024/005', 7, 7, 'auto', 45000000, 0, 'rejected', true, 0.87, false, NOW() - INTERVAL '15 days', NULL, 'Fraud indicators detected. Claim rejected pending investigation.', NOW() - INTERVAL '15 days', NOW()),
('CLM/2024/006', 8, 8, 'comprehensive', 120000000, 120000000, 'settled', false, 0.06, false, NOW() - INTERVAL '60 days', NOW() - INTERVAL '10 days', 'Claim settled in full. No compliance issues.', NOW() - INTERVAL '60 days', NOW()),
('CLM/2024/007', 4, 4, 'life', 150000000, 150000000, 'approved', false, 0.03, false, NOW() - INTERVAL '5 days', NULL, 'Life claim approved. Settlement pending documentation.', NOW() - INTERVAL '5 days', NOW()),
('CLM/2024/008', 6, 6, 'liability', 80000000, 65000000, 'partially_approved', false, 0.15, false, NOW() - INTERVAL '25 days', NULL, 'Partial liability settlement agreed.', NOW() - INTERVAL '25 days', NOW());

-- Seed open_banking_consents (correct column names)
INSERT INTO open_banking_consents (consent_ref, company_id, customer_id, data_scopes, third_party_name, third_party_country, consent_status, granted_at, expires_at, revoked_at, data_minimisation_compliant, cross_border_transfer, created_at, updated_at) VALUES
('OBC-2024-001', 1, 'CUST-NG-001', '{"balance": true, "transactions": true, "identity": true}', 'Creditinfo Nigeria', 'Nigeria', 'active', NOW() - INTERVAL '30 days', NOW() + INTERVAL '335 days', NULL, true, false, NOW() - INTERVAL '30 days', NOW()),
('OBC-2024-002', 2, 'CUST-NG-002', '{"payment": true, "standing_order": true}', 'Remita Payment Services', 'Nigeria', 'active', NOW() - INTERVAL '15 days', NOW() + INTERVAL '350 days', NULL, true, false, NOW() - INTERVAL '15 days', NOW()),
('OBC-2024-003', 3, 'CUST-NG-003', '{"balance": true, "transactions": true}', 'Experian Africa', 'United Kingdom', 'expired', NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days', NULL, false, true, NOW() - INTERVAL '60 days', NOW()),
('OBC-2024-004', 4, 'CUST-NG-004', '{"payment": true}', 'Quickteller Business', 'Nigeria', 'active', NOW() - INTERVAL '5 days', NOW() + INTERVAL '360 days', NULL, true, false, NOW() - INTERVAL '5 days', NOW()),
('OBC-2024-005', 1, 'CUST-NG-005', '{"balance": true, "transactions": true, "identity": true, "credit_score": true}', 'TransUnion Africa', 'South Africa', 'revoked', NOW() - INTERVAL '90 days', NOW() + INTERVAL '275 days', NOW() - INTERVAL '20 days', false, true, NOW() - INTERVAL '90 days', NOW()),
('OBC-2024-006', 5, 'CUST-NG-006', '{"payment": true, "direct_debit": true}', 'Paga Commerce Bank', 'Nigeria', 'active', NOW() - INTERVAL '10 days', NOW() + INTERVAL '355 days', NULL, true, false, NOW() - INTERVAL '10 days', NOW()),
('OBC-2024-007', 6, 'CUST-NG-007', '{"balance": true}', 'Stanbic IBTC Nominees', 'Nigeria', 'active', NOW() - INTERVAL '20 days', NOW() + INTERVAL '345 days', NULL, true, false, NOW() - INTERVAL '20 days', NOW()),
('OBC-2024-008', 7, 'CUST-NG-008', '{"payment": true}', 'Visa Worldwide Pte Ltd', 'Singapore', 'pending', NOW() - INTERVAL '45 days', NOW() + INTERVAL '320 days', NULL, false, true, NOW() - INTERVAL '45 days', NOW()),
('OBC-2024-009', 9, 'CUST-NG-009', '{"balance": true, "transactions": true}', 'NIBSS Plc', 'Nigeria', 'active', NOW() - INTERVAL '7 days', NOW() + INTERVAL '358 days', NULL, true, false, NOW() - INTERVAL '7 days', NOW()),
('OBC-2024-010', 10, 'CUST-NG-010', '{"balance": true, "transactions": true, "identity": true}', 'Mastercard International', 'United States', 'active', NOW() - INTERVAL '3 days', NOW() + INTERVAL '362 days', NULL, false, true, NOW() - INTERVAL '3 days', NOW());

-- Seed penalty_appeals (correct column names)
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal, evidence_summary, evidence_urls, requested_outcome, status, created_at, updated_at)
SELECT 
    fp.id,
    fp.organization_id,
    'Chief Compliance Officer',
    'compliance@' || LOWER(REPLACE(fp.organization_name, ' ', '')) || '.com',
    'The penalty amount of ₦' || fp.amount || ' is disproportionate to the violation severity. Our organisation has since implemented all required remediation measures and achieved full compliance with the relevant data protection provisions.',
    'Evidence package includes: (1) Updated data processing agreements, (2) Staff training completion certificates, (3) Technical audit report showing remediation, (4) NDPC compliance self-assessment.',
    '["https://evidence.ndsep.gov.ng/appeal/' || fp.id || '/doc1.pdf", "https://evidence.ndsep.gov.ng/appeal/' || fp.id || '/doc2.pdf"]'::jsonb,
    'Reduction of penalty by 50% and conversion of remaining amount to compliance undertaking',
    'submitted',
    NOW() - INTERVAL '3 days',
    NOW()
FROM financial_penalties fp
WHERE fp.id IN (1, 2, 3, 4, 5);

-- Seed platform_revenue_splits (correct column names using actual invoice IDs)
INSERT INTO platform_revenue_splits (payment_id, invoice_id, dpco_org_id, total_amount, platform_share, dpco_share, platform_fee_rate, currency, split_at, platform_paid_out, dpco_paid_out, metadata, created_at)
VALUES 
(1, 3, 1, 450000.00, 135000.00, 315000.00, 0.30, 'NGN', NOW() - INTERVAL '90 days', true, true, '{"quarter": "2024-Q1", "description": "Platform revenue split Q1 2024"}'::jsonb, NOW() - INTERVAL '90 days'),
(2, 4, 2, 520000.00, 156000.00, 364000.00, 0.30, 'NGN', NOW() - INTERVAL '60 days', true, true, '{"quarter": "2024-Q2", "description": "Platform revenue split Q2 2024"}'::jsonb, NOW() - INTERVAL '60 days'),
(3, 5, 3, 610000.00, 183000.00, 427000.00, 0.30, 'NGN', NOW() - INTERVAL '30 days', true, false, '{"quarter": "2024-Q3", "description": "Platform revenue split Q3 2024"}'::jsonb, NOW() - INTERVAL '30 days');
