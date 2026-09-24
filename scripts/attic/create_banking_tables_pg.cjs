#!/usr/bin/env node
/**
 * Create all banking service tables in PostgreSQL
 * Covers: KYC, AML, NIP, RTGS, SWIFT, Fraud, CBN Reports, Correspondent Banks, Watchlist
 * Business rules: CBN Circular FPR/DIR/CIR/07/003, NFIU AML/CFT Guidelines 2022, FATF Recommendations
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL ||
    'postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db',
  ssl: false,
});

const tables = [
  // ── Banking Institutions ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS banking_institutions (
    id                   SERIAL PRIMARY KEY,
    name                 VARCHAR(255) NOT NULL,
    cbn_license_number   VARCHAR(50) UNIQUE NOT NULL,
    institution_type     VARCHAR(50) NOT NULL DEFAULT 'commercial_bank',
    bvn_integration      BOOLEAN DEFAULT FALSE,
    nin_integration      BOOLEAN DEFAULT FALSE,
    swift_bic            VARCHAR(11) UNIQUE,
    nip_member_code      VARCHAR(20) UNIQUE,
    rtgs_member_code     VARCHAR(20) UNIQUE,
    cbn_category         VARCHAR(50) DEFAULT 'tier1',
    status               VARCHAR(30) DEFAULT 'active',
    headquarters_state   VARCHAR(50),
    total_assets_ngn     BIGINT,
    capital_adequacy_ratio NUMERIC(5,2),
    cbn_examination_date DATE,
    next_examination_date DATE,
    aml_risk_rating      VARCHAR(20) DEFAULT 'low',
    last_aml_review_date DATE,
    correspondent_count  INTEGER DEFAULT 0,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── KYC Records ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kyc_records (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    customer_ref         VARCHAR(100) UNIQUE NOT NULL,
    customer_type        VARCHAR(30) DEFAULT 'individual',
    full_name            VARCHAR(255) NOT NULL,
    bvn                  VARCHAR(11),
    nin                  VARCHAR(11),
    date_of_birth        DATE,
    nationality          VARCHAR(100),
    address              TEXT,
    state_of_residence   VARCHAR(50),
    occupation           VARCHAR(100),
    annual_income_band   VARCHAR(50),
    source_of_funds      VARCHAR(100),
    kyc_tier             INTEGER DEFAULT 1,
    kyc_status           VARCHAR(30) DEFAULT 'pending',
    risk_rating          VARCHAR(20) DEFAULT 'low',
    pep_flag             BOOLEAN DEFAULT FALSE,
    pep_details          TEXT,
    sanctions_flag       BOOLEAN DEFAULT FALSE,
    adverse_media_flag   BOOLEAN DEFAULT FALSE,
    id_document_type     VARCHAR(50),
    id_document_number   VARCHAR(100),
    id_expiry_date       DATE,
    id_verified          BOOLEAN DEFAULT FALSE,
    liveness_check       BOOLEAN DEFAULT FALSE,
    address_verified     BOOLEAN DEFAULT FALSE,
    last_review_date     DATE,
    next_review_date     DATE,
    reviewed_by          VARCHAR(100),
    rejection_reason     TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── AML Cases ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS aml_cases (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    case_reference       VARCHAR(50) UNIQUE NOT NULL,
    case_type            VARCHAR(50) NOT NULL,
    subject_name         VARCHAR(255),
    subject_account      VARCHAR(50),
    subject_bvn          VARCHAR(11),
    alert_source         VARCHAR(50) DEFAULT 'system',
    alert_score          NUMERIC(5,2),
    risk_level           VARCHAR(20) DEFAULT 'medium',
    status               VARCHAR(30) DEFAULT 'open',
    assigned_to          VARCHAR(100),
    transaction_amount   BIGINT,
    transaction_currency VARCHAR(3) DEFAULT 'NGN',
    transaction_date     DATE,
    str_filed            BOOLEAN DEFAULT FALSE,
    str_reference        VARCHAR(50),
    str_filed_date       DATE,
    nfiu_reported        BOOLEAN DEFAULT FALSE,
    nfiu_reference       VARCHAR(50),
    escalated            BOOLEAN DEFAULT FALSE,
    escalation_reason    TEXT,
    investigation_notes  TEXT,
    resolution_notes     TEXT,
    resolved_at          TIMESTAMPTZ,
    resolved_by          VARCHAR(100),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── NIP Transactions ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS nip_transactions (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    session_id           VARCHAR(50) UNIQUE NOT NULL,
    transaction_ref      VARCHAR(50) UNIQUE NOT NULL,
    channel              VARCHAR(20) DEFAULT 'nip',
    transaction_type     VARCHAR(30) DEFAULT 'credit',
    originating_bank     VARCHAR(100),
    originating_account  VARCHAR(20),
    originating_name     VARCHAR(255),
    beneficiary_bank     VARCHAR(100),
    beneficiary_account  VARCHAR(20) NOT NULL,
    beneficiary_name     VARCHAR(255),
    amount               BIGINT NOT NULL,
    currency             VARCHAR(3) DEFAULT 'NGN',
    narration            TEXT,
    status               VARCHAR(30) DEFAULT 'pending',
    response_code        VARCHAR(10),
    response_message     TEXT,
    processing_time_ms   INTEGER,
    aml_flagged          BOOLEAN DEFAULT FALSE,
    aml_case_id          INTEGER REFERENCES aml_cases(id),
    sanctions_checked    BOOLEAN DEFAULT FALSE,
    value_date           DATE,
    settlement_date      DATE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── RTGS Transactions ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS rtgs_transactions (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    rtgs_reference       VARCHAR(50) UNIQUE NOT NULL,
    transaction_type     VARCHAR(30) DEFAULT 'customer_credit',
    sending_bank         VARCHAR(100),
    sending_account      VARCHAR(20),
    sending_name         VARCHAR(255),
    receiving_bank       VARCHAR(100),
    receiving_account    VARCHAR(20) NOT NULL,
    receiving_name       VARCHAR(255),
    amount               BIGINT NOT NULL,
    currency             VARCHAR(3) DEFAULT 'NGN',
    narration            TEXT,
    priority             VARCHAR(20) DEFAULT 'normal',
    status               VARCHAR(30) DEFAULT 'queued',
    settlement_time      TIMESTAMPTZ,
    rejection_code       VARCHAR(10),
    rejection_reason     TEXT,
    aml_flagged          BOOLEAN DEFAULT FALSE,
    aml_case_id          INTEGER REFERENCES aml_cases(id),
    value_date           DATE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── SWIFT Messages ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS swift_messages (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    message_reference    VARCHAR(50) UNIQUE NOT NULL,
    message_type         VARCHAR(10) NOT NULL,
    direction            VARCHAR(10) DEFAULT 'outbound',
    sender_bic           VARCHAR(11),
    receiver_bic         VARCHAR(11),
    correspondent_id     INTEGER,
    amount               BIGINT,
    currency             VARCHAR(3),
    value_date           DATE,
    ordering_customer    VARCHAR(255),
    beneficiary_customer VARCHAR(255),
    beneficiary_account  VARCHAR(50),
    details_of_charges   VARCHAR(10) DEFAULT 'SHA',
    remittance_info      TEXT,
    status               VARCHAR(30) DEFAULT 'pending',
    ack_received         BOOLEAN DEFAULT FALSE,
    ack_timestamp        TIMESTAMPTZ,
    nack_reason          TEXT,
    sanctions_screened   BOOLEAN DEFAULT FALSE,
    sanctions_hit        BOOLEAN DEFAULT FALSE,
    sanctions_details    TEXT,
    processing_time_ms   INTEGER,
    raw_message          TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Fraud Alerts ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS fraud_alerts (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    alert_reference      VARCHAR(50) UNIQUE NOT NULL,
    fraud_type           VARCHAR(50) NOT NULL,
    channel              VARCHAR(30) DEFAULT 'digital',
    customer_ref         VARCHAR(100),
    account_number       VARCHAR(20),
    transaction_ref      VARCHAR(50),
    amount               BIGINT,
    currency             VARCHAR(3) DEFAULT 'NGN',
    risk_score           NUMERIC(5,2),
    risk_level           VARCHAR(20) DEFAULT 'medium',
    status               VARCHAR(30) DEFAULT 'open',
    detection_method     VARCHAR(50) DEFAULT 'rule_engine',
    ml_model_version     VARCHAR(20),
    rule_triggered       VARCHAR(100),
    device_fingerprint   VARCHAR(255),
    ip_address           INET,
    location             VARCHAR(100),
    confirmed_fraud      BOOLEAN DEFAULT FALSE,
    false_positive       BOOLEAN DEFAULT FALSE,
    customer_notified    BOOLEAN DEFAULT FALSE,
    card_blocked         BOOLEAN DEFAULT FALSE,
    account_frozen       BOOLEAN DEFAULT FALSE,
    investigation_notes  TEXT,
    resolved_at          TIMESTAMPTZ,
    resolved_by          VARCHAR(100),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── CBN Reports ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS cbn_reports (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    report_reference     VARCHAR(50) UNIQUE NOT NULL,
    report_type          VARCHAR(50) NOT NULL,
    reporting_period     VARCHAR(20) NOT NULL,
    period_start         DATE NOT NULL,
    period_end           DATE NOT NULL,
    due_date             DATE NOT NULL,
    submission_date      DATE,
    status               VARCHAR(30) DEFAULT 'draft',
    data_payload         JSONB,
    total_transactions   INTEGER,
    total_value_ngn      BIGINT,
    str_count            INTEGER DEFAULT 0,
    ctr_count            INTEGER DEFAULT 0,
    aml_cases_count      INTEGER DEFAULT 0,
    submitted_by         VARCHAR(100),
    cbn_acknowledgment   VARCHAR(100),
    cbn_feedback         TEXT,
    resubmission_count   INTEGER DEFAULT 0,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Correspondent Banks ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS correspondent_banks (
    id                   SERIAL PRIMARY KEY,
    bank_id              INTEGER REFERENCES banking_institutions(id),
    correspondent_name   VARCHAR(255) NOT NULL,
    correspondent_bic    VARCHAR(11) UNIQUE NOT NULL,
    country              VARCHAR(100) NOT NULL,
    currency             VARCHAR(3) NOT NULL,
    relationship_type    VARCHAR(20) DEFAULT 'nostro',
    nostro_account       VARCHAR(50),
    vostro_account       VARCHAR(50),
    status               VARCHAR(30) DEFAULT 'active',
    daily_limit          BIGINT,
    monthly_limit        BIGINT,
    kyc_completed        BOOLEAN DEFAULT FALSE,
    aml_risk_rating      VARCHAR(20) DEFAULT 'low',
    fatf_compliant       BOOLEAN DEFAULT TRUE,
    ofac_cleared         BOOLEAN DEFAULT TRUE,
    last_review_date     DATE,
    next_review_date     DATE,
    contact_name         VARCHAR(255),
    contact_email        VARCHAR(255),
    agreement_date       DATE,
    agreement_expiry     DATE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Watchlist / Sanctions ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS watchlist_entries (
    id                   SERIAL PRIMARY KEY,
    list_source          VARCHAR(50) NOT NULL,
    list_type            VARCHAR(50) NOT NULL,
    entity_type          VARCHAR(30) DEFAULT 'individual',
    full_name            VARCHAR(255) NOT NULL,
    aliases              JSONB,
    date_of_birth        DATE,
    nationality          VARCHAR(100),
    id_numbers           JSONB,
    addresses            JSONB,
    reason               TEXT,
    designation_date     DATE,
    delisting_date       DATE,
    status               VARCHAR(20) DEFAULT 'active',
    ofac_sdn             BOOLEAN DEFAULT FALSE,
    un_consolidated      BOOLEAN DEFAULT FALSE,
    eu_consolidated      BOOLEAN DEFAULT FALSE,
    uk_hmt               BOOLEAN DEFAULT FALSE,
    nfiu_list            BOOLEAN DEFAULT FALSE,
    terrorism_link       BOOLEAN DEFAULT FALSE,
    pep_link             BOOLEAN DEFAULT FALSE,
    last_updated         TIMESTAMPTZ DEFAULT NOW(),
    created_at           TIMESTAMPTZ DEFAULT NOW()
  )`,
];

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_kyc_bank ON kyc_records(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kyc_bvn ON kyc_records(bvn)`,
  `CREATE INDEX IF NOT EXISTS idx_kyc_nin ON kyc_records(nin)`,
  `CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_records(kyc_status)`,
  `CREATE INDEX IF NOT EXISTS idx_aml_bank ON aml_cases(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_aml_status ON aml_cases(status)`,
  `CREATE INDEX IF NOT EXISTS idx_aml_risk ON aml_cases(risk_level)`,
  `CREATE INDEX IF NOT EXISTS idx_nip_bank ON nip_transactions(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nip_status ON nip_transactions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_nip_created ON nip_transactions(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rtgs_bank ON rtgs_transactions(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rtgs_status ON rtgs_transactions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_swift_bank ON swift_messages(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_swift_type ON swift_messages(message_type)`,
  `CREATE INDEX IF NOT EXISTS idx_fraud_bank ON fraud_alerts(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_alerts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_fraud_risk ON fraud_alerts(risk_level)`,
  `CREATE INDEX IF NOT EXISTS idx_cbn_bank ON cbn_reports(bank_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cbn_status ON cbn_reports(status)`,
  `CREATE INDEX IF NOT EXISTS idx_watchlist_name ON watchlist_entries(full_name)`,
  `CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist_entries(status)`,
];

async function run() {
  let created = 0, errors = 0;
  for (const sql of tables) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || 'unknown';
    try {
      await pool.query(sql);
      console.log(`✓ ${tableName}`);
      created++;
    } catch (e) {
      console.error(`✗ ${tableName}: ${e.message}`);
      errors++;
    }
  }
  for (const sql of indexes) {
    try { await pool.query(sql); } catch (e) { /* ignore duplicate index */ }
  }
  console.log(`\nDone. ${created}/${tables.length} tables created/verified. ${errors} errors.`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
