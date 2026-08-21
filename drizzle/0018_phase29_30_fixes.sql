-- ============================================================
-- Migration: 0018_phase29_30_fixes.sql
-- Description: Phase 29 & 30 schema fixes — KYC aliases,
--   AML enum, Phase13 tables, penalty JSONB columns,
--   data residency defaults
-- Applied: 2026-04-23
-- ============================================================

-- ── 1. KYC Records ───────────────────────────────────────────
-- Add customer_type as alias column for subject_type
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50);
UPDATE kyc_records SET customer_type = subject_type WHERE customer_type IS NULL;

-- Add customer_ref if missing
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS customer_ref VARCHAR(100);
UPDATE kyc_records SET customer_ref = CONCAT('CUST-', LPAD(id::text, 6, '0')) WHERE customer_ref IS NULL;

-- ── 2. AML Cases ─────────────────────────────────────────────
-- Add 'closed' to aml_case_status enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'closed'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'aml_case_status')
  ) THEN
    ALTER TYPE aml_case_status ADD VALUE 'closed';
  END IF;
END$$;

-- Add case_reference as alias for case_ref
ALTER TABLE aml_cases ADD COLUMN IF NOT EXISTS case_reference VARCHAR(50);
UPDATE aml_cases SET case_reference = case_ref WHERE case_reference IS NULL;

-- ── 3. Phase 13 — DPO Appointments ──────────────────────────
CREATE TABLE IF NOT EXISTS dpo_appointments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  dpo_name VARCHAR(255) NOT NULL,
  dpo_email VARCHAR(255),
  dpo_phone VARCHAR(50),
  appointment_date TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Phase 13 — Penalty Calculations ──────────────────────
CREATE TABLE IF NOT EXISTS penalty_calculations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  violation_type VARCHAR(100),
  base_penalty NUMERIC(20,2),
  final_penalty NUMERIC(20,2),
  aggravating_factors JSONB DEFAULT '[]',
  mitigating_factors JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'draft',
  calculated_by VARCHAR(255),
  approved_by VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate existing TEXT[] columns to JSONB if the table already existed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'penalty_calculations'
    AND column_name = 'aggravating_factors'
    AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE penalty_calculations
      ALTER COLUMN aggravating_factors TYPE JSONB USING aggravating_factors::text::jsonb,
      ALTER COLUMN mitigating_factors TYPE JSONB USING mitigating_factors::text::jsonb;
  END IF;
END$$;

-- ── 5. Phase 13 — Cross-Border Transfers ────────────────────
CREATE TABLE IF NOT EXISTS cross_border_transfers (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  transfer_ref VARCHAR(100) UNIQUE,
  destination_country VARCHAR(100),
  data_categories JSONB DEFAULT '[]',
  legal_basis VARCHAR(100),
  adequacy_decision BOOLEAN DEFAULT FALSE,
  safeguards TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Data Residency Locations — add defaults ───────────────
ALTER TABLE data_residency_locations
  ALTER COLUMN location_name SET DEFAULT 'Unknown Location',
  ALTER COLUMN country SET DEFAULT 'NG',
  ALTER COLUMN city SET DEFAULT 'Lagos',
  ALTER COLUMN data_center_name SET DEFAULT 'Primary DC',
  ALTER COLUMN provider SET DEFAULT 'On-Premises';

-- ── 7. Indexes for new columns ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kyc_records_customer_ref ON kyc_records(customer_ref);
CREATE INDEX IF NOT EXISTS idx_kyc_records_customer_type ON kyc_records(customer_type);
CREATE INDEX IF NOT EXISTS idx_aml_cases_case_reference ON aml_cases(case_reference);
CREATE INDEX IF NOT EXISTS idx_penalty_calculations_org ON penalty_calculations(organization_id);
CREATE INDEX IF NOT EXISTS idx_penalty_calculations_status ON penalty_calculations(status);
CREATE INDEX IF NOT EXISTS idx_cross_border_transfers_org ON cross_border_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_dpo_appointments_org ON dpo_appointments(organization_id);
