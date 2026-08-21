-- =============================================================================
-- NDSEP Platform — Comprehensive Seed Script
-- Creates all tables (IF NOT EXISTS) and seeds with realistic Nigerian data.
-- Run: sudo -u postgres psql -d ndsep_db -f scripts/seed-all.sql
-- Or:  psql "$DATABASE_URL" -f scripts/seed-all.sql
-- Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING where possible,
-- and checks for existing data before inserting.
-- =============================================================================

-- =============================================================================
-- PART 0: Create ndsep_user if needed (for new environments)
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ndsep_user') THEN
    CREATE ROLE ndsep_user WITH LOGIN PASSWORD 'ndsep_secure_2026' CREATEDB;
    GRANT ALL PRIVILEGES ON DATABASE ndsep_db TO ndsep_user;
  END IF;
END $$;

-- =============================================================================
-- PART 1: Banking Tables (10 tables)
-- =============================================================================
CREATE TABLE IF NOT EXISTS banking_institutions (
  id SERIAL PRIMARY KEY,
  cbn_code VARCHAR(20) UNIQUE,
  sort_code VARCHAR(20),
  bic_code VARCHAR(20),
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100),
  license_type VARCHAR(50) DEFAULT 'commercial',
  license_number VARCHAR(50),
  status VARCHAR(50) DEFAULT 'licensed',
  head_office_address TEXT,
  ceo_name VARCHAR(255),
  total_assets NUMERIC(20,2),
  capital_adequacy_ratio NUMERIC(6,2),
  non_performing_loan_ratio NUMERIC(6,2),
  data_protection_officer VARCHAR(255),
  dpco_org_id INTEGER,
  compliance_score NUMERIC(6,2) DEFAULT 75.0,
  last_examination_date DATE,
  next_examination_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_records (
  id SERIAL PRIMARY KEY,
  reference_id VARCHAR(50) UNIQUE,
  bank_id INTEGER REFERENCES banking_institutions(id),
  subject_type VARCHAR(30) DEFAULT 'individual',
  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  nationality VARCHAR(100) DEFAULT 'Nigerian',
  bvn VARCHAR(20),
  nin VARCHAR(20),
  address TEXT,
  phone VARCHAR(30),
  email VARCHAR(255),
  risk_level VARCHAR(20) DEFAULT 'low',
  status VARCHAR(30) DEFAULT 'pending',
  customer_ref VARCHAR(50),
  tier VARCHAR(10) DEFAULT 'tier1',
  pep_flag BOOLEAN DEFAULT false,
  sanctions_flag BOOLEAN DEFAULT false,
  bvn_verified BOOLEAN DEFAULT false,
  nin_verified BOOLEAN DEFAULT false,
  address_verified BOOLEAN DEFAULT false,
  face_match_score NUMERIC(5,2),
  liveness_score NUMERIC(5,2),
  phone_number VARCHAR(30),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aml_cases (
  id SERIAL PRIMARY KEY,
  case_ref VARCHAR(50) UNIQUE,
  bank_id INTEGER REFERENCES banking_institutions(id),
  subject_name VARCHAR(255),
  subject_type VARCHAR(50) DEFAULT 'individual',
  subject_bvn VARCHAR(20),
  case_type VARCHAR(50) DEFAULT 'suspicious_transaction',
  status VARCHAR(30) DEFAULT 'open',
  risk_score INTEGER DEFAULT 50,
  pep_match BOOLEAN DEFAULT false,
  sanctions_match BOOLEAN DEFAULT false,
  narrative TEXT,
  amount NUMERIC(20,2),
  currency VARCHAR(10) DEFAULT 'NGN',
  assigned_to VARCHAR(255),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist_entries (
  id SERIAL PRIMARY KEY,
  entity_id VARCHAR(50) UNIQUE,
  entity_type VARCHAR(30) DEFAULT 'individual',
  primary_name VARCHAR(255) NOT NULL,
  aliases TEXT,
  date_of_birth DATE,
  nationality VARCHAR(100),
  source VARCHAR(100) DEFAULT 'NFIU',
  list_type VARCHAR(50) DEFAULT 'sanctions',
  reason TEXT,
  is_active BOOLEAN DEFAULT true,
  added_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nip_transactions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) UNIQUE,
  sender_bank_code VARCHAR(20),
  sender_bank_name VARCHAR(255),
  sender_account_number VARCHAR(20),
  sender_account_name VARCHAR(255),
  receiver_bank_code VARCHAR(20),
  receiver_bank_name VARCHAR(255),
  receiver_account_number VARCHAR(20),
  receiver_account_name VARCHAR(255),
  amount NUMERIC(20,2),
  narration TEXT,
  status VARCHAR(30) DEFAULT 'pending',
  channel VARCHAR(30) DEFAULT 'web',
  response_code VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rtgs_transactions (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(50) UNIQUE,
  sender_bank_code VARCHAR(20),
  sender_account_number VARCHAR(20),
  receiver_bank_code VARCHAR(20),
  receiver_account_number VARCHAR(20),
  amount NUMERIC(20,2),
  currency VARCHAR(10) DEFAULT 'NGN',
  status VARCHAR(30) DEFAULT 'pending',
  settlement_date DATE,
  narration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swift_messages (
  id SERIAL PRIMARY KEY,
  message_ref VARCHAR(50) UNIQUE,
  message_type VARCHAR(10) DEFAULT 'MT103',
  sender_bic VARCHAR(20),
  receiver_bic VARCHAR(20),
  amount NUMERIC(20,2),
  currency VARCHAR(10) DEFAULT 'USD',
  beneficiary_name VARCHAR(255),
  beneficiary_account VARCHAR(50),
  ordering_customer VARCHAR(255),
  status VARCHAR(30) DEFAULT 'pending',
  narrative TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id SERIAL PRIMARY KEY,
  alert_ref VARCHAR(50) UNIQUE,
  bank_id INTEGER REFERENCES banking_institutions(id),
  transaction_ref VARCHAR(50),
  transaction_amount NUMERIC(20,2),
  account_number VARCHAR(20),
  alert_type VARCHAR(50) DEFAULT 'suspicious_transaction',
  severity VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(30) DEFAULT 'open',
  description TEXT,
  assigned_to VARCHAR(255),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  risk_score INTEGER DEFAULT 70,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cbn_reports (
  id SERIAL PRIMARY KEY,
  report_ref VARCHAR(50) UNIQUE,
  bank_id INTEGER REFERENCES banking_institutions(id),
  report_type VARCHAR(50) DEFAULT 'prudential_return',
  reporting_period VARCHAR(30),
  status VARCHAR(30) DEFAULT 'draft',
  due_date DATE,
  submitted_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}',
  narrative TEXT,
  filing_deadline DATE,
  cbn_ack_ref VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS correspondent_banks (
  id SERIAL PRIMARY KEY,
  bank_id INTEGER REFERENCES banking_institutions(id),
  correspondent_name VARCHAR(255) NOT NULL,
  correspondent_bic VARCHAR(20),
  country VARCHAR(100),
  currency VARCHAR(10) DEFAULT 'USD',
  account_number VARCHAR(50),
  relationship_type VARCHAR(50) DEFAULT 'nostro',
  status VARCHAR(30) DEFAULT 'active',
  risk_rating VARCHAR(20) DEFAULT 'low',
  last_review_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- PART 2: Stripe Payment Intents (empty table that needs seeding)
-- =============================================================================
-- Table already exists from schema; just seed if empty.

-- =============================================================================
-- PART 3: Seed Banking Data
-- =============================================================================

-- Banking Institutions (Nigerian banks)
INSERT INTO banking_institutions (cbn_code, sort_code, bic_code, name, short_name, license_type, license_number, status, head_office_address, ceo_name, total_assets, capital_adequacy_ratio, non_performing_loan_ratio, data_protection_officer, compliance_score)
SELECT * FROM (VALUES
  ('001', '011', 'FIDTNGLA', 'First Bank of Nigeria Plc', 'FirstBank', 'commercial', 'CBN/COM/001', 'licensed', '35 Marina, Lagos Island, Lagos', 'Olusegun Alebiosu', 10245000000000.00, 17.80, 4.20, 'Dr. Amina Obi', 92.50),
  ('002', '033', 'UBABORCE', 'United Bank for Africa Plc', 'UBA', 'commercial', 'CBN/COM/002', 'licensed', '57 Marina, Lagos Island, Lagos', 'Oliver Alawuba', 9850000000000.00, 24.70, 3.10, 'Engr. Tunde Fashola', 88.00),
  ('003', '044', 'ABORNGLA', 'Access Bank Plc', 'Access', 'commercial', 'CBN/COM/003', 'licensed', '999C Danmole Street, Victoria Island, Lagos', 'Roosevelt Ogbonna', 15800000000000.00, 22.30, 3.50, 'Dr. Chioma Ugwu', 95.20),
  ('004', '058', 'GTBINGLA', 'Guaranty Trust Holding Co. Plc', 'GTBank', 'commercial', 'CBN/COM/004', 'licensed', '635 Akin Adesola Street, Victoria Island, Lagos', 'Segun Agbaje', 6200000000000.00, 25.10, 5.10, 'Barr. Funke Adeola', 90.80),
  ('005', '057', 'ZEABORCE', 'Zenith Bank Plc', 'Zenith', 'commercial', 'CBN/COM/005', 'licensed', '87 Ajose Adeogun Street, Victoria Island, Lagos', 'Ebenezer Onyeagwu', 12800000000000.00, 21.40, 4.80, 'Mr. Ikenna Nwosu', 87.30),
  ('006', '050', 'ECLININGLA', 'Ecobank Nigeria Plc', 'Ecobank', 'commercial', 'CBN/COM/006', 'licensed', '21 Ahmadu Bello Way, Victoria Island, Lagos', 'Bolaji Lawal', 3200000000000.00, 15.20, 6.30, 'Mrs. Ngozi Eze', 78.50),
  ('007', '070', 'FCMBNGLA', 'Fidelity Bank Plc', 'Fidelity', 'commercial', 'CBN/COM/007', 'licensed', '2 Kofo Abayomi Street, Victoria Island, Lagos', 'Nneka Onyeali-Ikpe', 4500000000000.00, 18.90, 5.70, 'Dr. Emeka Okafor', 85.00),
  ('008', '030', 'HEABORCE', 'Heritage Bank Plc', 'Heritage', 'commercial', 'CBN/COM/008', 'under_examination', '292A Ajose Adeogun Street, Victoria Island, Lagos', 'Ifie Sekibo', 800000000000.00, 10.50, 12.40, 'Mr. Yusuf Garba', 62.40),
  ('009', '082', 'KEYABORCE', 'Keystone Bank Limited', 'Keystone', 'commercial', 'CBN/COM/009', 'licensed', '1 Keystone Crescent, Victoria Island, Lagos', 'Hassan Imam', 1200000000000.00, 14.30, 7.80, 'Mrs. Halima Mohammed', 80.10),
  ('010', '076', 'ABORNGLA2', 'Polaris Bank Limited', 'Polaris', 'commercial', 'CBN/COM/010', 'provisional', '3 Akin Adesola Street, Victoria Island, Lagos', 'Innocent Ike', 1500000000000.00, 12.80, 9.20, 'Dr. Sunday Adewale', 71.80)
) AS t(cbn_code, sort_code, bic_code, name, short_name, license_type, license_number, status, head_office_address, ceo_name, total_assets, capital_adequacy_ratio, non_performing_loan_ratio, data_protection_officer, compliance_score)
WHERE NOT EXISTS (SELECT 1 FROM banking_institutions LIMIT 1);

-- KYC Records
INSERT INTO kyc_records (reference_id, bank_id, subject_type, full_name, date_of_birth, nationality, bvn, nin, address, phone, email, risk_level, status, customer_ref)
SELECT * FROM (VALUES
  ('KYC-2025-0001', 1, 'individual', 'Adebayo Ogundimu', '1985-03-15'::date, 'Nigerian', '22345678901', '98765432101', '15 Broad Street, Lagos Island, Lagos', '+2348012345678', 'adebayo.ogundimu@example.com', 'low', 'verified', 'CUST-FB-0001'),
  ('KYC-2025-0002', 2, 'individual', 'Chidinma Nwosu', '1990-07-22'::date, 'Nigerian', '22345678902', '98765432102', '42 Aba Road, Port Harcourt, Rivers', '+2348023456789', 'chidinma.nwosu@example.com', 'low', 'verified', 'CUST-UBA-0001'),
  ('KYC-2025-0003', 3, 'corporate', 'Dangote Industries Limited', '2000-01-01'::date, 'Nigerian', '33345678903', '88765432103', '1 Alfred Rewane Road, Ikoyi, Lagos', '+2348034567890', 'compliance@dangote.com', 'medium', 'verified', 'CORP-ACC-0001'),
  ('KYC-2025-0004', 4, 'individual', 'Folake Adeyemi', '1988-11-30'::date, 'Nigerian', '22345678904', '98765432104', '7 Awolowo Road, Ikoyi, Lagos', '+2348045678901', 'folake.adeyemi@example.com', 'low', 'verified', 'CUST-GTB-0001'),
  ('KYC-2025-0005', 5, 'individual', 'Ibrahim Musa', '1975-05-10'::date, 'Nigerian', '22345678905', '98765432105', '23 Ahmadu Bello Way, Kaduna', '+2348056789012', 'ibrahim.musa@example.com', 'high', 'pending', 'CUST-ZEN-0001'),
  ('KYC-2025-0006', 1, 'corporate', 'MTN Nigeria Communications Plc', '2001-05-16'::date, 'Nigerian', '33345678906', '88765432106', 'Golden Plaza, Falomo, Ikoyi, Lagos', '+2348067890123', 'kyc@mtn.ng', 'medium', 'verified', 'CORP-FB-0002'),
  ('KYC-2025-0007', 3, 'individual', 'Ngozi Okafor', '1992-09-03'::date, 'Nigerian', '22345678907', '98765432107', '14 Ozumba Mbadiwe Avenue, Victoria Island, Lagos', '+2348078901234', 'ngozi.okafor@example.com', 'low', 'verified', 'CUST-ACC-0002'),
  ('KYC-2025-0008', 5, 'pep', 'Alhaji Ahmed Bello', '1960-12-01'::date, 'Nigerian', '22345678908', '98765432108', 'Government House, Abuja FCT', '+2348089012345', 'ahmed.bello@gov.ng', 'high', 'enhanced_review', 'CUST-ZEN-0002'),
  ('KYC-2025-0009', 2, 'individual', 'Oluwaseun Bakare', '1995-04-18'::date, 'Nigerian', '22345678909', '98765432109', '33 Herbert Macaulay Way, Yaba, Lagos', '+2348090123456', 'oluwaseun.bakare@example.com', 'low', 'verified', 'CUST-UBA-0002'),
  ('KYC-2025-0010', 4, 'individual', 'Fatima Abubakar', '1987-08-25'::date, 'Nigerian', '22345678910', '98765432110', '5 Sultan Road, Sokoto', '+2348001234567', 'fatima.abubakar@example.com', 'medium', 'pending', 'CUST-GTB-0002')
) AS t(reference_id, bank_id, subject_type, full_name, date_of_birth, nationality, bvn, nin, address, phone, email, risk_level, status, customer_ref)
WHERE NOT EXISTS (SELECT 1 FROM kyc_records LIMIT 1);

-- AML Cases
INSERT INTO aml_cases (case_ref, bank_id, subject_name, subject_type, subject_bvn, case_type, status, risk_score, pep_match, sanctions_match, narrative, amount, currency, assigned_to)
SELECT * FROM (VALUES
  ('AML-2025-0001', 1, 'Suspicious Transfer Ring', 'corporate', '33345678903', 'suspicious_transaction', 'open', 85, false, false, 'Multiple high-value transfers to offshore accounts detected. Pattern consistent with layering phase of money laundering. Total volume exceeds N500M in 30 days.', 750000000.00, 'NGN', 'Compliance Team A'),
  ('AML-2025-0002', 3, 'Alhaji Ahmed Bello', 'individual', '22345678908', 'pep_monitoring', 'under_investigation', 92, true, false, 'PEP account flagged for unusual transaction patterns. Government official with transactions inconsistent with declared income. NFIU STR filed.', 120000000.00, 'NGN', 'Special Investigations'),
  ('AML-2025-0003', 5, 'Bureau De Change Network', 'corporate', '33345678999', 'currency_smuggling', 'open', 78, false, false, 'Coordinated forex transactions across 12 BDC outlets exceeding CBN limits. Suspected round-tripping of naira-dollar conversions.', 2500000000.00, 'NGN', 'FX Compliance'),
  ('AML-2025-0004', 2, 'Unknown Subject', 'individual', '22345678950', 'terrorist_financing', 'escalated', 95, false, true, 'NFIU intelligence: account linked to designated entity on UNSCR sanctions list. Immediate freeze order applied. Coordination with DSS ongoing.', 45000000.00, 'NGN', 'CTF Unit'),
  ('AML-2025-0005', 4, 'Real Estate SPV Ltd', 'corporate', '33345678960', 'suspicious_transaction', 'closed', 45, false, false, 'High-value property purchase investigation. Source of funds verified through legitimate business income. Case closed — no further action.', 380000000.00, 'NGN', 'Compliance Team B'),
  ('AML-2025-0006', 1, 'Chibuzo Okwuosa', 'individual', '22345678970', 'structuring', 'open', 72, false, false, 'Multiple cash deposits below N5M reporting threshold across 8 branches in Lagos. Pattern consistent with structuring to avoid CTR filing.', 38000000.00, 'NGN', 'Branch Compliance'),
  ('AML-2025-0007', 6, 'Cross-Border Payments Co', 'corporate', '33345678980', 'correspondent_risk', 'under_investigation', 68, false, false, 'Correspondent banking channel used for high-volume low-value transfers to West African jurisdictions with weak AML controls.', 890000000.00, 'USD', 'International Ops'),
  ('AML-2025-0008', 7, 'Maryam Ibrahim', 'individual', '22345678990', 'fraud', 'open', 81, false, false, 'Account takeover and unauthorized fund transfers totaling N12M. Victim confirmed identity theft. Criminal referral to EFCC pending.', 12000000.00, 'NGN', 'Fraud Investigations')
) AS t(case_ref, bank_id, subject_name, subject_type, subject_bvn, case_type, status, risk_score, pep_match, sanctions_match, narrative, amount, currency, assigned_to)
WHERE NOT EXISTS (SELECT 1 FROM aml_cases LIMIT 1);

-- Watchlist Entries
INSERT INTO watchlist_entries (entity_id, entity_type, primary_name, aliases, date_of_birth, nationality, source, list_type, reason, is_active, added_by)
SELECT * FROM (VALUES
  ('NFIU-WL-001', 'individual', 'Victor Okonkwo', 'Victor O., V.C. Okonkwo', '1978-06-15'::date, 'Nigerian', 'NFIU', 'sanctions', 'Designated under Nigerian financial sanctions regime for proliferation financing', true, 'NFIU Compliance'),
  ('NFIU-WL-002', 'corporate', 'West Africa Trading Corp', 'WAT Corp, WA Trading', NULL, 'Nigerian', 'NFIU', 'sanctions', 'Shell company linked to sanctions evasion network operating across ECOWAS region', true, 'NFIU Intelligence'),
  ('OFAC-WL-003', 'individual', 'Ahmed Hassan Al-Rashid', 'A. Hassan, Al-Rashid Ahmed', '1965-03-22'::date, 'Unknown', 'OFAC', 'sdnlist', 'OFAC SDN List — designated for supporting terrorist organizations', true, 'US Treasury/OFAC'),
  ('EU-WL-004', 'corporate', 'Meridian Shipping LLC', 'Meridian Ships, MSL', NULL, 'UAE', 'EU', 'sanctions', 'EU sanctions for involvement in illicit arms transfers to conflict zones', true, 'EU Council'),
  ('NFIU-WL-005', 'individual', 'Princess Adaeze Nwankwo', 'Princess Ada, P.A. Nwankwo', '1982-11-08'::date, 'Nigerian', 'NFIU', 'pep', 'Politically Exposed Person — state-level government official with unexplained wealth indicators', true, 'NFIU PEP Registry'),
  ('UN-WL-006', 'individual', 'Moussa Diallo', 'M. Diallo, Moussa D.', '1970-01-15'::date, 'Mali', 'UNSCR', 'sanctions', 'UN Security Council Resolution 2374 — designated for threatening peace in Mali', true, 'UN Sanctions Committee'),
  ('EFCC-WL-007', 'individual', 'Chief Emeka Obiora', 'E. Obiora, Chief Obiora', '1958-09-20'::date, 'Nigerian', 'EFCC', 'fraud', 'EFCC wanted list — alleged N15B fraud against Federal Government agencies', true, 'EFCC Intelligence'),
  ('NFIU-WL-008', 'corporate', 'Global Crypto Exchange Ltd', 'GCE, GlobalCrypto', NULL, 'Nigeria', 'NFIU', 'monitoring', 'Unregistered virtual asset service provider operating without SEC/CBN license', true, 'NFIU/SEC Joint Task Force')
) AS t(entity_id, entity_type, primary_name, aliases, date_of_birth, nationality, source, list_type, reason, is_active, added_by)
WHERE NOT EXISTS (SELECT 1 FROM watchlist_entries LIMIT 1);

-- NIP Transactions
INSERT INTO nip_transactions (session_id, sender_bank_code, sender_bank_name, sender_account_number, sender_account_name, receiver_bank_code, receiver_bank_name, receiver_account_number, receiver_account_name, amount, narration, status, channel, response_code)
SELECT * FROM (VALUES
  ('NIP-2025-001', '011', 'First Bank', '3012345678', 'Adebayo Ogundimu', '044', 'Access Bank', '0123456789', 'Dangote Industries Ltd', 5000000.00, 'Invoice payment — Q1 2025', 'successful', 'web', '00'),
  ('NIP-2025-002', '033', 'UBA', '2098765432', 'Chidinma Nwosu', '058', 'GTBank', '0987654321', 'Folake Adeyemi', 250000.00, 'Rent payment January 2025', 'successful', 'mobile', '00'),
  ('NIP-2025-003', '057', 'Zenith', '2034567890', 'Ibrahim Musa', '011', 'First Bank', '3045678901', 'MTN Nigeria', 1500000.00, 'Annual subscription renewal', 'successful', 'web', '00'),
  ('NIP-2025-004', '044', 'Access Bank', '0111222333', 'Ngozi Okafor', '033', 'UBA', '2033344455', 'Oluwaseun Bakare', 75000.00, 'Personal transfer', 'successful', 'ussd', '00'),
  ('NIP-2025-005', '058', 'GTBank', '0999888777', 'Folake Adeyemi', '057', 'Zenith', '2066677788', 'Fatima Abubakar', 180000.00, 'School fees payment', 'failed', 'mobile', '51'),
  ('NIP-2025-006', '011', 'First Bank', '3078901234', 'Adebayo Ogundimu', '082', 'Keystone', '1023456789', 'Keystone Savings', 3200000.00, 'Fixed deposit transfer', 'successful', 'web', '00'),
  ('NIP-2025-007', '050', 'Ecobank', '6234567890', 'Ecobank Client A', '070', 'Fidelity', '5012345678', 'Fidelity Investments', 12000000.00, 'Corporate disbursement', 'pending', 'api', NULL),
  ('NIP-2025-008', '033', 'UBA', '2011223344', 'Oluwaseun Bakare', '044', 'Access Bank', '0198765432', 'Access Savings', 45000.00, 'Airtime purchase', 'successful', 'ussd', '00')
) AS t(session_id, sender_bank_code, sender_bank_name, sender_account_number, sender_account_name, receiver_bank_code, receiver_bank_name, receiver_account_number, receiver_account_name, amount, narration, status, channel, response_code)
WHERE NOT EXISTS (SELECT 1 FROM nip_transactions LIMIT 1);

-- RTGS Transactions
INSERT INTO rtgs_transactions (reference, sender_bank_code, sender_account_number, receiver_bank_code, receiver_account_number, amount, currency, status, settlement_date, narration)
SELECT * FROM (VALUES
  ('RTGS-2025-001', '011', '3012345678', '044', '0123456789', 500000000.00, 'NGN', 'settled', '2025-01-15'::date, 'FGN Bond settlement — Series 042'),
  ('RTGS-2025-002', '057', '2034567890', '033', '2098765432', 1200000000.00, 'NGN', 'settled', '2025-01-20'::date, 'Interbank lending — overnight facility'),
  ('RTGS-2025-003', '058', '0999888777', '011', '3045678901', 350000000.00, 'NGN', 'settled', '2025-02-01'::date, 'Treasury bill redemption'),
  ('RTGS-2025-004', '044', '0111222333', '057', '2066677788', 2800000000.00, 'NGN', 'pending', '2025-02-10'::date, 'CBN special intervention fund disbursement'),
  ('RTGS-2025-005', '033', '2011223344', '050', '6234567890', 750000000.00, 'NGN', 'settled', '2025-02-15'::date, 'Correspondent bank nostro funding'),
  ('RTGS-2025-006', '070', '5012345678', '082', '1023456789', 180000000.00, 'NGN', 'failed', '2025-02-20'::date, 'Capital market settlement — insufficient cover')
) AS t(reference, sender_bank_code, sender_account_number, receiver_bank_code, receiver_account_number, amount, currency, status, settlement_date, narration)
WHERE NOT EXISTS (SELECT 1 FROM rtgs_transactions LIMIT 1);

-- SWIFT Messages
INSERT INTO swift_messages (message_ref, message_type, sender_bic, receiver_bic, amount, currency, beneficiary_name, beneficiary_account, ordering_customer, status, narrative)
SELECT * FROM (VALUES
  ('SWIFT-2025-001', 'MT103', 'FIDTNGLA', 'CHASUS33', 5000000.00, 'USD', 'Apple Inc', 'US-CHQ-44556677', 'MTN Nigeria Communications Plc', 'delivered', 'Equipment procurement — 5G infrastructure'),
  ('SWIFT-2025-002', 'MT103', 'UBABORCE', 'BARCGB22', 2500000.00, 'GBP', 'Oxford University Press', 'GB-NWB-11223344', 'Federal Ministry of Education', 'delivered', 'Textbook procurement — UBEC program'),
  ('SWIFT-2025-003', 'MT202', 'ZEABORCE', 'DEUTDEFF', 8000000.00, 'EUR', 'Siemens AG', 'DE-DB-99887766', 'Nigerian Railway Corporation', 'pending', 'Rolling stock maintenance contract payment'),
  ('SWIFT-2025-004', 'MT103', 'GTBINGLA', 'CITIUS33', 1200000.00, 'USD', 'Amazon Web Services', 'US-CITI-55667788', 'Interswitch Limited', 'delivered', 'Cloud infrastructure annual subscription'),
  ('SWIFT-2025-005', 'MT103', 'ABOLNGLA', 'SCBLHKHH', 3500000.00, 'USD', 'Huawei Technologies', 'HK-SCB-33445566', 'Nigerian Communications Commission', 'processing', 'Network monitoring equipment — NCC mandate'),
  ('SWIFT-2025-006', 'MT700', 'FIDTNGLA', 'ABORNGLA', 15000000.00, 'USD', 'Shell Petroleum', 'NL-ABN-77889900', 'NNPC Limited', 'delivered', 'Letter of credit — crude oil forward contract')
) AS t(message_ref, message_type, sender_bic, receiver_bic, amount, currency, beneficiary_name, beneficiary_account, ordering_customer, status, narrative)
WHERE NOT EXISTS (SELECT 1 FROM swift_messages LIMIT 1);

-- Fraud Alerts
INSERT INTO fraud_alerts (alert_ref, bank_id, transaction_ref, transaction_amount, account_number, alert_type, severity, status, description, assigned_to)
SELECT * FROM (VALUES
  ('FRD-2025-001', 1, 'NIP-SUS-001', 12000000.00, '3012345678', 'account_takeover', 'critical', 'open', 'Multiple login attempts from foreign IP addresses followed by unauthorized fund transfer attempt. Account temporarily frozen.', 'Fraud Team Alpha'),
  ('FRD-2025-002', 3, 'NIP-SUS-002', 8500000.00, '0111222333', 'sim_swap', 'high', 'under_investigation', 'SIM swap detected on account linked to high-value corporate entity. Transaction initiated within 30 minutes of SIM change.', 'Fraud Team Beta'),
  ('FRD-2025-003', 2, 'NIP-SUS-003', 2300000.00, '2098765432', 'phishing', 'medium', 'resolved', 'Customer fell victim to phishing email impersonating bank. Funds recovered through NIBSS dispute resolution within 48 hours.', 'Fraud Recovery'),
  ('FRD-2025-004', 5, 'POS-SUS-001', 450000.00, '2034567890', 'card_cloning', 'high', 'open', 'Cloned debit card used at multiple POS terminals across Lagos. Original card holder confirmed they were in Abuja at the time.', 'Card Fraud Unit'),
  ('FRD-2025-005', 4, 'ATM-SUS-001', 1800000.00, '0987654321', 'atm_skimming', 'critical', 'escalated', 'ATM skimming device found at Victoria Island branch. 15 accounts potentially compromised. All affected cards blocked.', 'Physical Security'),
  ('FRD-2025-006', 7, 'MOB-SUS-001', 950000.00, '5012345678', 'social_engineering', 'medium', 'open', 'Customer deceived into sharing OTP via phone call impersonating bank customer service. N950K transferred before alert triggered.', 'Fraud Team Alpha'),
  ('FRD-2025-007', 1, 'WEB-SUS-001', 25000000.00, '3078901234', 'business_email_compromise', 'critical', 'under_investigation', 'CFO email account compromised. Payment instruction for N25M to unknown beneficiary intercepted by Treasury before execution.', 'Cyber Fraud Unit'),
  ('FRD-2025-008', 6, 'USSD-SUS-001', 180000.00, '6234567890', 'unauthorized_ussd', 'low', 'closed', 'Unauthorized USSD transfer from feature phone. Customer confirmed phone was stolen. Insurance claim processed.', 'Fraud Recovery')
) AS t(alert_ref, bank_id, transaction_ref, transaction_amount, account_number, alert_type, severity, status, description, assigned_to)
WHERE NOT EXISTS (SELECT 1 FROM fraud_alerts LIMIT 1);

-- CBN Reports
INSERT INTO cbn_reports (report_ref, bank_id, report_type, reporting_period, status, due_date, narrative)
SELECT * FROM (VALUES
  ('CBN-RPT-2025-001', 1, 'prudential_return', 'Q4 2024', 'submitted', '2025-01-31'::date, 'Quarterly prudential return — capital adequacy, asset quality, earnings, liquidity ratios'),
  ('CBN-RPT-2025-002', 2, 'prudential_return', 'Q4 2024', 'submitted', '2025-01-31'::date, 'Quarterly prudential return — all ratios within CBN acceptable thresholds'),
  ('CBN-RPT-2025-003', 3, 'aml_compliance', 'H2 2024', 'submitted', '2025-02-28'::date, 'Semi-annual AML/CFT compliance report — 12 STRs filed, 3 CTRs, 0 sanctions breaches'),
  ('CBN-RPT-2025-004', 5, 'forex_position', 'January 2025', 'draft', '2025-02-15'::date, 'Monthly net open position report — FX exposure within 20% of shareholders funds'),
  ('CBN-RPT-2025-005', 4, 'credit_concentration', 'Q4 2024', 'overdue', '2025-01-15'::date, 'Single obligor limit compliance report — one breach identified in oil & gas sector'),
  ('CBN-RPT-2025-006', 8, 'prudential_return', 'Q4 2024', 'draft', '2025-01-31'::date, 'Quarterly prudential return — CAR below minimum threshold, remediation plan attached'),
  ('CBN-RPT-2025-007', 1, 'cybersecurity_report', 'Annual 2024', 'submitted', '2025-03-31'::date, 'Annual cybersecurity risk assessment — ISO 27001 certified, SOC2 Type II audit complete'),
  ('CBN-RPT-2025-008', 6, 'aml_compliance', 'H2 2024', 'submitted', '2025-02-28'::date, 'Semi-annual AML/CFT report — enhanced monitoring of correspondent banking channels')
) AS t(report_ref, bank_id, report_type, reporting_period, status, due_date, narrative)
WHERE NOT EXISTS (SELECT 1 FROM cbn_reports LIMIT 1);

-- Correspondent Banks
INSERT INTO correspondent_banks (bank_id, correspondent_name, correspondent_bic, country, currency, account_number, relationship_type, status, risk_rating, last_review_date)
SELECT * FROM (VALUES
  (1, 'JPMorgan Chase Bank N.A.', 'CHASUS33', 'United States', 'USD', 'JPMCB-NG-001', 'nostro', 'active', 'low', '2024-12-01'::date),
  (1, 'Standard Chartered Bank London', 'SCBLGB2L', 'United Kingdom', 'GBP', 'SCB-NG-001', 'nostro', 'active', 'low', '2024-11-15'::date),
  (2, 'Deutsche Bank AG', 'DEUTDEFF', 'Germany', 'EUR', 'DB-UBA-001', 'nostro', 'active', 'low', '2024-10-20'::date),
  (3, 'Citibank N.A.', 'CITIUS33', 'United States', 'USD', 'CITI-ACC-001', 'nostro', 'active', 'low', '2024-12-10'::date),
  (4, 'HSBC Holdings Plc', 'HSBCHKHH', 'Hong Kong', 'HKD', 'HSBC-GTB-001', 'nostro', 'active', 'medium', '2024-09-30'::date),
  (5, 'Bank of China', 'BKCHCNBJ', 'China', 'CNY', 'BOC-ZEN-001', 'nostro', 'active', 'medium', '2024-08-15'::date),
  (1, 'Ecobank Transnational', 'EABOREST', 'Togo', 'XOF', 'ETI-FB-001', 'vostro', 'active', 'medium', '2024-11-01'::date),
  (2, 'Standard Bank South Africa', 'SBZAZAJJ', 'South Africa', 'ZAR', 'SBSA-UBA-001', 'nostro', 'active', 'low', '2024-12-05'::date),
  (3, 'Arab African International Bank', 'ARAIEGCX', 'Egypt', 'EGP', 'AAIB-ACC-001', 'nostro', 'active', 'medium', '2024-07-20'::date),
  (5, 'Commerzbank AG', 'COBADEFF', 'Germany', 'EUR', 'COBA-ZEN-001', 'nostro', 'active', 'low', '2024-10-10'::date)
) AS t(bank_id, correspondent_name, correspondent_bic, country, currency, account_number, relationship_type, status, risk_rating, last_review_date)
WHERE NOT EXISTS (SELECT 1 FROM correspondent_banks LIMIT 1);

-- Stripe Payment Intents (if empty)
INSERT INTO stripe_payment_intents (stripe_intent_id, penalty_id, org_id, amount_ngn, amount_usd, currency, status)
SELECT * FROM (VALUES
  ('pi_3QwXyZ000001', 1, 1, 2500000.00, 1562.50, 'NGN', 'succeeded'),
  ('pi_3QwXyZ000002', 2, 3, 1500000.00, 937.50, 'NGN', 'succeeded'),
  ('pi_3QwXyZ000003', NULL, 5, 500000.00, 312.50, 'NGN', 'succeeded'),
  ('pi_3QwXyZ000004', 3, 2, 3000000.00, 1875.00, 'NGN', 'pending'),
  ('pi_3QwXyZ000005', 4, 4, 750000.00, 468.75, 'NGN', 'succeeded'),
  ('pi_3QwXyZ000006', NULL, 6, 1000000.00, 625.00, 'NGN', 'failed')
) AS t(stripe_intent_id, penalty_id, org_id, amount_ngn, amount_usd, currency, status)
WHERE NOT EXISTS (SELECT 1 FROM stripe_payment_intents LIMIT 1);

-- =============================================================================
-- PART 4: Grant permissions to ndsep_user
-- =============================================================================
DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('GRANT ALL ON TABLE public.' || quote_ident(tablename) || ' TO ndsep_user;', E'\n')
    FROM pg_tables WHERE schemaname = 'public'
  );
  EXECUTE (
    SELECT string_agg('GRANT USAGE, SELECT ON SEQUENCE ' || quote_ident(sequencename) || ' TO ndsep_user;', E'\n')
    FROM pg_sequences WHERE schemaname = 'public'
  );
END $$;

-- =============================================================================
-- VERIFICATION: Show row counts
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  cnt BIGINT;
BEGIN
  RAISE NOTICE '=== NDSEP Seed Verification ===';
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.tablename) INTO cnt;
    RAISE NOTICE '% : % rows', rpad(r.tablename, 35), cnt;
  END LOOP;
  RAISE NOTICE '=== Seeding Complete ===';
END $$;
