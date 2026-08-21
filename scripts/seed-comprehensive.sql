-- NDSEP Comprehensive Seed Data
-- Enhanced dataset for production-ready platform demonstration
-- Includes realistic Nigerian organizations, compliance data, financial penalties, and more.
-- Run: psql $DATABASE_URL < scripts/seed-comprehensive.sql

BEGIN;

-- ── Additional Organizations (Nigerian enterprises) ──────────────────────────
INSERT INTO organizations (name, registration_number, sector, country, city, latitude, longitude, compliance_score, compliance_status, agent_installed, risk_score, contact_email, declared_asset_count, discovered_asset_count)
VALUES
  ('Zenith Bank Plc', 'RC-ZBP-001', 'Banking & Finance', 'Nigeria', 'Lagos', 6.4541, 3.3947, 88.5, 'compliant', true, 15.0, 'compliance@zenithbank.com', 450, 430),
  ('Dangote Industries Ltd', 'RC-DIL-002', 'Manufacturing', 'Nigeria', 'Lagos', 6.4550, 3.3892, 76.2, 'under_review', true, 35.0, 'dpo@dangote.com', 320, 290),
  ('Flutterwave Inc', 'RC-FWI-003', 'Fintech', 'Nigeria', 'Lagos', 6.4363, 3.4520, 92.0, 'compliant', true, 10.0, 'security@flutterwave.com', 180, 175),
  ('Access Bank Plc', 'RC-ABP-004', 'Banking & Finance', 'Nigeria', 'Lagos', 6.4350, 3.4580, 85.3, 'compliant', true, 18.0, 'dataprotection@accessbankplc.com', 520, 500),
  ('Nigerian Breweries Plc', 'RC-NBP-005', 'Manufacturing', 'Nigeria', 'Lagos', 6.6018, 3.3515, 71.0, 'under_review', false, 40.0, 'compliance@nbplc.com', 150, 120),
  ('Interswitch Group', 'RC-ISG-006', 'Fintech', 'Nigeria', 'Lagos', 6.4363, 3.4520, 89.7, 'compliant', true, 12.0, 'security@interswitchgroup.com', 200, 195),
  ('BUA Group', 'RC-BUA-007', 'Manufacturing', 'Nigeria', 'Abuja', 9.0579, 7.4951, 68.5, 'non_compliant', false, 55.0, 'dpo@buagroup.com', 100, 75),
  ('Globacom Ltd', 'RC-GLO-008', 'Telecommunications', 'Nigeria', 'Lagos', 6.4281, 3.4219, 80.1, 'under_review', true, 28.0, 'dataprotection@gloworld.com', 800, 750),
  ('Stanbic IBTC Holdings', 'RC-SIH-009', 'Banking & Finance', 'Nigeria', 'Lagos', 6.4350, 3.4580, 91.2, 'compliant', true, 9.0, 'compliance@stanbicibtc.com', 380, 370),
  ('Paystack', 'RC-PSK-010', 'Fintech', 'Nigeria', 'Lagos', 6.4363, 3.4520, 94.5, 'compliant', true, 8.0, 'security@paystack.com', 120, 118)
ON CONFLICT (registration_number) DO NOTHING;

-- ── Additional Assets ────────────────────────────────────────────────────────
INSERT INTO assets (organization_id, name, asset_type, status, ip_address, location, cloud_provider, cloud_region)
SELECT o.id, a.name, a.asset_type::asset_type, a.status::asset_status, a.ip_address, a.location, a.cloud_provider, a.cloud_region
FROM (VALUES
  ('Zenith Bank Plc', 'Core Banking System', 'software', 'active', '10.1.1.100', 'Lagos DC1', 'aws', 'af-south-1'),
  ('Zenith Bank Plc', 'ATM Network Controller', 'hardware', 'active', '10.1.2.50', 'Lagos DC1', NULL, NULL),
  ('Zenith Bank Plc', 'Mobile Banking API', 'cloud', 'active', '10.1.3.200', 'Lagos DC2', 'aws', 'af-south-1'),
  ('Dangote Industries Ltd', 'ERP System (SAP)', 'software', 'active', '172.16.1.10', 'Abuja HQ', 'azure', 'southafricanorth'),
  ('Dangote Industries Ltd', 'IoT Sensors Network', 'hardware', 'active', '172.16.2.0', 'Obajana Plant', NULL, NULL),
  ('Flutterwave Inc', 'Payment Gateway', 'cloud', 'active', '10.5.1.1', 'Lagos', 'aws', 'af-south-1'),
  ('Flutterwave Inc', 'Fraud Detection ML', 'cloud', 'active', '10.5.2.1', 'Lagos', 'gcp', 'africa-south1'),
  ('Access Bank Plc', 'Internet Banking Portal', 'software', 'active', '10.2.1.100', 'Lagos HQ', 'aws', 'af-south-1'),
  ('Interswitch Group', 'Verve Card Processor', 'software', 'active', '10.6.1.1', 'Lagos', NULL, NULL),
  ('Paystack', 'Checkout API', 'cloud', 'active', '10.8.1.1', 'Lagos', 'aws', 'eu-west-1')
) AS a(org_name, name, asset_type, status, ip_address, location, cloud_provider, cloud_region)
JOIN organizations o ON o.name = a.org_name
ON CONFLICT DO NOTHING;

-- ── Additional Compliance Policies ───────────────────────────────────────────
INSERT INTO compliance_policies (name, description, category, severity, is_active, enforcement_date)
VALUES
  ('NDPA Article 25 - Right to Erasure', 'Data subjects right to request deletion of personal data', 'Data Subject Rights', 'high', true, '2025-01-15'),
  ('NDPA Article 28 - Cross-Border Transfer', 'Restrictions on transfer of personal data outside Nigeria', 'Cross-Border Transfer', 'critical', true, '2025-01-15'),
  ('NDPA Article 30 - Data Retention', 'Personal data must not be kept longer than necessary', 'Data Retention', 'medium', true, '2025-03-01'),
  ('CBN Risk Framework - Customer Due Diligence', 'KYC/AML compliance requirements for financial institutions', 'Financial Compliance', 'critical', true, '2024-06-01'),
  ('NCC Data Protection Directive', 'Telecom-specific data protection requirements per NCC guidelines', 'Sector Regulation', 'high', true, '2025-01-01'),
  ('NDPR Implementation Framework', 'Nigeria Data Protection Regulation implementation guidelines', 'General Compliance', 'high', true, '2024-01-01'),
  ('NDPA Article 33 - Breach Notification', 'Mandatory breach notification within 72 hours to NDPC', 'Incident Management', 'critical', true, '2025-01-15'),
  ('NDPA Article 14 - Lawful Processing', 'Six lawful bases for processing personal data under NDPA', 'Processing Basis', 'high', true, '2025-01-15')
ON CONFLICT DO NOTHING;

-- ── Additional Enforcement Actions ───────────────────────────────────────────
INSERT INTO enforcement_actions (organization_id, action_type, description, status, penalty_amount, issued_date)
SELECT o.id, a.action_type, a.description, a.status::enforcement_status, a.penalty_amount, a.issued_date::timestamp
FROM (VALUES
  ('BUA Group', 'penalty_imposed', 'Failure to appoint Data Protection Officer as required by NDPA', 'penalty_imposed', 5000000.00, '2025-08-15'),
  ('Nigerian Breweries Plc', 'notice_sent', 'Inadequate consent mechanisms for marketing communications', 'notice_sent', 0, '2025-09-01'),
  ('Globacom Ltd', 'audit_scheduled', 'Routine telecommunications data protection audit', 'audit_scheduled', 0, '2025-10-01'),
  ('Dangote Industries Ltd', 'notice_sent', 'Cross-border data transfer without adequacy determination', 'notice_sent', 0, '2025-07-20')
) AS a(org_name, action_type, description, status, penalty_amount, issued_date)
JOIN organizations o ON o.name = a.org_name
ON CONFLICT DO NOTHING;

-- ── Additional Breach Incidents ──────────────────────────────────────────────
INSERT INTO breach_incidents (organization_id, title, description, severity, status, affected_records, detected_at, reported_at)
SELECT o.id, b.title, b.description, b.severity::severity, b.status, b.affected_records, b.detected_at::timestamp, b.reported_at::timestamp
FROM (VALUES
  ('Zenith Bank Plc', 'Phishing Campaign Targeting Customers', 'Mass phishing emails impersonating bank communications, approximately 15,000 customers received fraudulent emails', 'high', 'resolved', 15000, '2025-06-10', '2025-06-10'),
  ('Flutterwave Inc', 'API Key Exposure in Public Repository', 'Developer accidentally committed API credentials to public GitHub repository', 'critical', 'resolved', 0, '2025-05-22', '2025-05-22'),
  ('Globacom Ltd', 'Unauthorized Access to Subscriber Records', 'Internal employee accessed subscriber call records without authorization', 'high', 'investigating', 2500, '2025-09-15', '2025-09-16'),
  ('Access Bank Plc', 'SQL Injection Attempt on Mobile API', 'Automated SQL injection attack detected and blocked by WAF', 'medium', 'resolved', 0, '2025-08-30', '2025-08-30')
) AS b(org_name, title, description, severity, status, affected_records, detected_at, reported_at)
JOIN organizations o ON o.name = b.org_name
ON CONFLICT DO NOTHING;

-- ── Additional Sectors ───────────────────────────────────────────────────────
INSERT INTO sectors (name, description, regulatory_body, risk_level, org_count)
VALUES
  ('Banking & Finance', 'Commercial banks, microfinance, and financial institutions regulated by CBN', 'Central Bank of Nigeria (CBN)', 'high', 25),
  ('Fintech', 'Digital payment providers, mobile money operators, and financial technology companies', 'CBN / SEC', 'high', 15),
  ('Telecommunications', 'Mobile network operators and ISPs regulated by NCC', 'Nigerian Communications Commission (NCC)', 'high', 8),
  ('Manufacturing', 'Industrial manufacturing companies including cement, food, and consumer goods', 'SON / NAFDAC', 'medium', 12),
  ('Oil & Gas', 'Upstream and downstream petroleum companies', 'DPR / NUPRC', 'high', 10),
  ('Healthcare', 'Hospitals, HMOs, pharmaceutical companies', 'FMOH / NAFDAC', 'critical', 20),
  ('Education', 'Universities, schools, and EdTech platforms', 'NUC / NBTE', 'medium', 30),
  ('Insurance', 'Insurance companies and brokers regulated by NAICOM', 'NAICOM', 'high', 18)
ON CONFLICT DO NOTHING;

-- ── Consent Records ──────────────────────────────────────────────────────────
INSERT INTO consent_records (organization_id, data_subject_email, purpose, legal_basis, status, consent_date, expiry_date)
SELECT o.id, c.email, c.purpose, c.legal_basis, c.status, c.consent_date::timestamp, c.expiry_date::timestamp
FROM (VALUES
  ('Zenith Bank Plc', 'customer1@example.com', 'Transaction processing and account management', 'contract', 'active', '2025-01-15', '2026-01-15'),
  ('Zenith Bank Plc', 'customer2@example.com', 'Marketing communications and product offers', 'consent', 'active', '2025-03-20', '2025-09-20'),
  ('Flutterwave Inc', 'merchant@shop.ng', 'Payment processing and fraud prevention', 'contract', 'active', '2025-02-01', '2026-02-01'),
  ('Globacom Ltd', 'subscriber@email.com', 'Network optimization and service improvement', 'legitimate_interest', 'active', '2025-04-10', '2026-04-10'),
  ('Access Bank Plc', 'applicant@gmail.com', 'Loan application processing', 'contract', 'expired', '2024-06-01', '2025-06-01')
) AS c(org_name, email, purpose, legal_basis, status, consent_date, expiry_date)
JOIN organizations o ON o.name = c.org_name
ON CONFLICT DO NOTHING;

-- ── DPO Appointments ─────────────────────────────────────────────────────────
INSERT INTO dpo_appointments (organization_id, dpo_name, email, phone, appointment_date, status, qualification)
SELECT o.id, d.dpo_name, d.email, d.phone, d.appointment_date::timestamp, d.status, d.qualification
FROM (VALUES
  ('Zenith Bank Plc', 'Adebayo Ogunlade', 'aogunlade@zenithbank.com', '+234-812-345-6789', '2025-01-10', 'active', 'CIPP/E, CIPM'),
  ('Flutterwave Inc', 'Chioma Nwankwo', 'cnwankwo@flutterwave.com', '+234-803-456-7890', '2025-02-15', 'active', 'CDPSE, CISM'),
  ('Dangote Industries Ltd', 'Ibrahim Musa', 'imusa@dangote.com', '+234-809-567-8901', '2025-03-01', 'active', 'CIPP/E'),
  ('Globacom Ltd', 'Funke Adeyemi', 'fadeyemi@gloworld.com', '+234-805-678-9012', '2025-01-20', 'active', 'CIPM, ISO 27701 LA'),
  ('Access Bank Plc', 'Emeka Okafor', 'eokafor@accessbankplc.com', '+234-811-789-0123', '2025-02-01', 'active', 'CIPP/E, CIPT')
) AS d(org_name, dpo_name, email, phone, appointment_date, status, qualification)
JOIN organizations o ON o.name = d.org_name
ON CONFLICT DO NOTHING;

COMMIT;
