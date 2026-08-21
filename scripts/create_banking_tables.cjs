#!/usr/bin/env node
// Banking tables creation script
const pg = require('pg');

// Try SSL first, then without
async function getPool() {
  const url = process.env.DATABASE_URL;
  // Try without SSL for local connections
  const pool = new pg.Pool({ 
    connectionString: url,
    ssl: url && url.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  return pool;
}

const statements = [
  `DO $$ BEGIN
    CREATE TYPE bank_license_type AS ENUM ('commercial','merchant','microfinance','development','mortgage','payment_service_bank','non_interest');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE bank_status AS ENUM ('licensed','provisional','suspended','revoked','under_examination');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE kyc_status AS ENUM ('pending','in_review','verified','rejected','expired','suspended');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE kyc_tier AS ENUM ('tier1','tier2','tier3');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE aml_case_status AS ENUM ('open','under_investigation','escalated','filed_str','closed_no_action','closed_action_taken');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE aml_case_type AS ENUM ('suspicious_transaction','pep_match','sanctions_match','structuring','unusual_pattern','high_risk_country','adverse_media','threshold_breach');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE watchlist_source AS ENUM ('ofac_sdn','un_consolidated','eu_consolidated','uk_hmt','cbn_internal','interpol','efcc','nfiu','local_court');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE watchlist_category AS ENUM ('sanctions','pep','adverse_media','terrorism','fraud','corruption','money_laundering');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE nip_status AS ENUM ('initiated','processing','completed','failed','reversed','pending_confirmation');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE rtgs_status AS ENUM ('queued','processing','settled','rejected','cancelled','pending_funds');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE swift_status AS ENUM ('draft','sent','acknowledged','processed','rejected','recalled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE fraud_alert_status AS ENUM ('open','investigating','confirmed_fraud','false_positive','escalated','resolved');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE fraud_alert_type AS ENUM ('velocity_breach','unusual_amount','geo_anomaly','device_fingerprint','account_takeover','synthetic_identity','card_not_present','social_engineering','insider_threat','ml_anomaly');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE cbn_report_type AS ENUM ('str','ctr','scuml_report','aml_annual','prudential_return','liquidity_return','capital_adequacy','credit_risk','operational_risk');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE cbn_report_status AS ENUM ('draft','pending_review','approved','submitted','acknowledged','rejected','overdue');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE correspondent_relationship AS ENUM ('nostro','vostro','loro','bilateral');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE correspondent_status AS ENUM ('active','suspended','terminated','under_review');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS banking_institutions (
    id SERIAL PRIMARY KEY,
    cbn_code VARCHAR(10) UNIQUE NOT NULL,
    sort_code VARCHAR(10) UNIQUE NOT NULL,
    bic_code VARCHAR(11),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50) NOT NULL,
    license_type bank_license_type NOT NULL,
    license_number VARCHAR(50) NOT NULL,
    status bank_status DEFAULT 'licensed' NOT NULL,
    head_office_address TEXT,
    ceo_name VARCHAR(255),
    total_assets BIGINT,
    capital_adequacy_ratio NUMERIC(5,2),
    non_performing_loan_ratio NUMERIC(5,2),
    data_protection_officer VARCHAR(255),
    dpco_org_id INTEGER,
    last_examination_date TIMESTAMP,
    next_examination_date TIMESTAMP,
    compliance_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kyc_records (
    id SERIAL PRIMARY KEY,
    reference_id VARCHAR(50) UNIQUE NOT NULL,
    organization_id INTEGER REFERENCES organizations(id),
    bank_id INTEGER REFERENCES banking_institutions(id),
    subject_type VARCHAR(30) DEFAULT 'individual' NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    date_of_birth VARCHAR(20),
    nationality VARCHAR(100) DEFAULT 'Nigerian',
    bvn VARCHAR(11),
    nin VARCHAR(11),
    phone_number VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    selfie_url VARCHAR(500),
    id_document_type VARCHAR(50),
    id_document_url VARCHAR(500),
    liveness_score NUMERIC(5,2),
    face_match_score NUMERIC(5,2),
    bvn_verified BOOLEAN DEFAULT false,
    nin_verified BOOLEAN DEFAULT false,
    address_verified BOOLEAN DEFAULT false,
    tier kyc_tier DEFAULT 'tier1' NOT NULL,
    status kyc_status DEFAULT 'pending' NOT NULL,
    risk_rating VARCHAR(20) DEFAULT 'low',
    pep_flag BOOLEAN DEFAULT false,
    sanctions_flag BOOLEAN DEFAULT false,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS aml_cases (
    id SERIAL PRIMARY KEY,
    case_ref VARCHAR(50) UNIQUE NOT NULL,
    organization_id INTEGER REFERENCES organizations(id),
    bank_id INTEGER REFERENCES banking_institutions(id),
    subject_name VARCHAR(255) NOT NULL,
    subject_type VARCHAR(30) DEFAULT 'individual',
    subject_bvn VARCHAR(11),
    case_type aml_case_type NOT NULL,
    status aml_case_status DEFAULT 'open' NOT NULL,
    risk_score INTEGER DEFAULT 0,
    pep_match BOOLEAN DEFAULT false,
    sanctions_match BOOLEAN DEFAULT false,
    adverse_media_match BOOLEAN DEFAULT false,
    transaction_amount BIGINT,
    transaction_currency VARCHAR(3) DEFAULT 'NGN',
    transaction_ref VARCHAR(100),
    source_of_funds TEXT,
    narrative TEXT,
    str_reference VARCHAR(50),
    str_filed_at TIMESTAMP,
    assigned_to VARCHAR(255),
    escalated_to VARCHAR(255),
    closed_at TIMESTAMP,
    closure_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist_entries (
    id SERIAL PRIMARY KEY,
    entity_id VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(30) DEFAULT 'individual',
    primary_name VARCHAR(255) NOT NULL,
    aliases JSONB DEFAULT '[]',
    date_of_birth VARCHAR(20),
    nationality VARCHAR(100),
    passport_number VARCHAR(50),
    source watchlist_source NOT NULL,
    category watchlist_category NOT NULL,
    risk_level VARCHAR(20) DEFAULT 'high',
    listing_date TIMESTAMP,
    delisting_date TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    reason TEXT,
    additional_info JSONB,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nip_transactions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(40) UNIQUE NOT NULL,
    name_enquiry_ref VARCHAR(40),
    sender_bank_code VARCHAR(10) NOT NULL,
    sender_bank_name VARCHAR(100),
    sender_account_number VARCHAR(20) NOT NULL,
    sender_account_name VARCHAR(255),
    receiver_bank_code VARCHAR(10) NOT NULL,
    receiver_bank_name VARCHAR(100),
    receiver_account_number VARCHAR(20) NOT NULL,
    receiver_account_name VARCHAR(255),
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    narration VARCHAR(255),
    status nip_status DEFAULT 'initiated' NOT NULL,
    response_code VARCHAR(10),
    response_message VARCHAR(255),
    nibss_ref VARCHAR(50),
    channel_code VARCHAR(10),
    aml_flagged BOOLEAN DEFAULT false,
    fraud_flagged BOOLEAN DEFAULT false,
    settlement_date TIMESTAMP,
    initiated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rtgs_transactions (
    id SERIAL PRIMARY KEY,
    reference VARCHAR(50) UNIQUE NOT NULL,
    sender_bank_code VARCHAR(10) NOT NULL,
    sender_bank_name VARCHAR(100),
    sender_account_number VARCHAR(20),
    receiver_bank_code VARCHAR(10) NOT NULL,
    receiver_bank_name VARCHAR(100),
    receiver_account_number VARCHAR(20),
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    narration TEXT,
    status rtgs_status DEFAULT 'queued' NOT NULL,
    priority VARCHAR(10) DEFAULT 'normal',
    settlement_cycle VARCHAR(10),
    cbn_ref VARCHAR(50),
    rejection_reason TEXT,
    queued_at TIMESTAMP DEFAULT NOW() NOT NULL,
    settled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS swift_messages (
    id SERIAL PRIMARY KEY,
    message_ref VARCHAR(50) UNIQUE NOT NULL,
    message_type VARCHAR(10) NOT NULL,
    sender_bic VARCHAR(11) NOT NULL,
    sender_bank_name VARCHAR(100),
    receiver_bic VARCHAR(11) NOT NULL,
    receiver_bank_name VARCHAR(100),
    amount BIGINT,
    currency VARCHAR(3),
    value_date VARCHAR(20),
    ordering_customer VARCHAR(255),
    beneficiary_customer VARCHAR(255),
    remittance_info TEXT,
    correspondent_bic VARCHAR(11),
    status swift_status DEFAULT 'draft' NOT NULL,
    ack_nak_code VARCHAR(10),
    sanctions_screened BOOLEAN DEFAULT false,
    sanctions_flagged BOOLEAN DEFAULT false,
    raw_message TEXT,
    sent_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fraud_alerts (
    id SERIAL PRIMARY KEY,
    alert_ref VARCHAR(50) UNIQUE NOT NULL,
    bank_id INTEGER REFERENCES banking_institutions(id),
    organization_id INTEGER REFERENCES organizations(id),
    transaction_ref VARCHAR(100),
    transaction_amount BIGINT,
    account_number VARCHAR(20),
    alert_type fraud_alert_type NOT NULL,
    risk_score INTEGER DEFAULT 0,
    ml_model VARCHAR(100),
    ml_confidence NUMERIC(5,2),
    rule_triggered VARCHAR(255),
    status fraud_alert_status DEFAULT 'open' NOT NULL,
    disposition VARCHAR(50),
    investigator_notes TEXT,
    assigned_to VARCHAR(255),
    blocked_at TIMESTAMP,
    resolved_at TIMESTAMP,
    detected_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cbn_reports (
    id SERIAL PRIMARY KEY,
    report_ref VARCHAR(50) UNIQUE NOT NULL,
    bank_id INTEGER REFERENCES banking_institutions(id),
    organization_id INTEGER REFERENCES organizations(id),
    report_type cbn_report_type NOT NULL,
    reporting_period VARCHAR(20) NOT NULL,
    status cbn_report_status DEFAULT 'draft' NOT NULL,
    filing_deadline TIMESTAMP,
    submitted_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    cbn_ack_ref VARCHAR(50),
    xml_payload TEXT,
    pdf_url VARCHAR(500),
    total_transactions INTEGER,
    total_amount BIGINT,
    rejection_reason TEXT,
    prepared_by VARCHAR(255),
    approved_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS correspondent_banks (
    id SERIAL PRIMARY KEY,
    bank_id INTEGER REFERENCES banking_institutions(id),
    correspondent_name VARCHAR(255) NOT NULL,
    correspondent_bic VARCHAR(11) UNIQUE NOT NULL,
    country VARCHAR(100) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    relationship_type correspondent_relationship NOT NULL,
    nostro_account VARCHAR(50),
    vostro_account VARCHAR(50),
    status correspondent_status DEFAULT 'active' NOT NULL,
    daily_limit BIGINT,
    monthly_limit BIGINT,
    kyc_completed BOOLEAN DEFAULT false,
    aml_risk_rating VARCHAR(20) DEFAULT 'low',
    last_review_date TIMESTAMP,
    next_review_date TIMESTAMP,
    agreement_url VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`
];

async function run() {
  const pool = await getPool();
  const client = await pool.connect();
  let created = 0;
  try {
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        created++;
      } catch(e) {
        if (!e.message.includes('already exists')) {
          console.error('Error on stmt:', e.message.substring(0, 120));
        }
      }
    }
    console.log('Done. Executed', created, 'of', statements.length, 'statements successfully');
    
    // Verify tables exist
    const res = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('banking_institutions','kyc_records','aml_cases','watchlist_entries',
        'nip_transactions','rtgs_transactions','swift_messages','fraud_alerts','cbn_reports','correspondent_banks')
      ORDER BY table_name
    `);
    console.log('Banking tables in DB:', res.rows.map(r => r.table_name).join(', '));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
