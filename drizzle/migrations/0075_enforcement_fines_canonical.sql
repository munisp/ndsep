-- Migration 0075: Canonical enforcement_fines table + fine-payment hardening
--
-- enforcement_fines was referenced by 0043 (payment_rrr_codes /
-- payment_reconciliations / payment_installments / receipts / refund_requests
-- FKs), by 0070 (indexes), and by the phase11 finePayment, phase12 fines and
-- finePayments routers, but no migration ever created it ("phantom table").
-- This migration creates the canonical superset DDL covering all consumers:
--
--   phase11 finePayment : id, case_id, org_id, amount, currency, status,
--                         issued_at, due_date, paid_at, payment_reference,
--                         payment_method, amount_paid, updated_at
--   phase12 fines       : org_id (fixed in code from organization_id), amount,
--                         currency, status, due_date, issued_at,
--                         violation_description, fine_reference, ndpc_reference
--   finePayments (RRR)  : id, org_id, amount, amount_paid, currency, status,
--                         paid_at, payment_reference, updated_at
--
-- Column naming is standardised on org_id (matches 0070's
-- idx_enforcement_fines_org and the phase11/finePayments routers); the phase12
-- router was fixed to use org_id instead of adding an alias column.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS enforcement_fines (
  id SERIAL PRIMARY KEY,
  case_id INTEGER,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'outstanding', 'waived', 'cancelled')),
  amount_paid NUMERIC(16, 2) NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference VARCHAR(255),
  payment_method VARCHAR(50),
  fine_reference VARCHAR(60),
  ndpc_reference VARCHAR(100),
  violation_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Converge any partially-created historical variant (all no-ops on the
-- canonical table above).
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS case_id INTEGER;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(16, 2) NOT NULL DEFAULT 0;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS fine_reference VARCHAR(60);
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS ndpc_reference VARCHAR(100);
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS violation_description TEXT;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- If a legacy variant was created with organization_id instead of org_id,
-- standardise on org_id and copy the values across.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enforcement_fines' AND column_name = 'organization_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enforcement_fines' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE enforcement_fines RENAME COLUMN organization_id TO org_id;
  END IF;
END $$;
ALTER TABLE enforcement_fines ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_enforcement_fines_org ON enforcement_fines (org_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_fines_status ON enforcement_fines (status);
CREATE INDEX IF NOT EXISTS idx_enforcement_fines_due ON enforcement_fines (due_date);

-- Idempotency anchor for phase11 finePayment.recordPayment: a payment
-- reference may be recorded exactly once platform-wide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enforcement_fines_payment_reference
  ON enforcement_fines (payment_reference)
  WHERE payment_reference IS NOT NULL;

-- ─── 0043 child tables (re-asserted so fresh provisions converge even if 0043
-- ran before the parent table existed) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_rrr_codes (
  id SERIAL PRIMARY KEY,
  rrr VARCHAR(20) NOT NULL UNIQUE,
  penalty_id INTEGER NOT NULL REFERENCES enforcement_fines(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'paid', 'expired', 'cancelled')),
  gateway_ref VARCHAR(100),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_rrr_penalty ON payment_rrr_codes (penalty_id);
CREATE INDEX IF NOT EXISTS idx_payment_rrr_pending ON payment_rrr_codes (status) WHERE status = 'generated';

-- Double-RRR race guard: at most one live (generated) or settled (paid) RRR
-- per penalty. Concurrent generateRrr calls now hit a unique violation
-- instead of minting two payable codes; the router converts the violation
-- into returning the existing live RRR.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_rrr_one_active_per_penalty
  ON payment_rrr_codes (penalty_id)
  WHERE status IN ('generated', 'paid');

CREATE TABLE IF NOT EXISTS payment_reconciliations (
  id SERIAL PRIMARY KEY,
  rrr VARCHAR(20) NOT NULL,
  penalty_id INTEGER REFERENCES enforcement_fines(id) ON DELETE SET NULL,
  matched_amount NUMERIC(14, 2),
  match_status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'partial', 'unmatched')),
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_recon_batch ON payment_reconciliations (batch_date, match_status);

CREATE TABLE IF NOT EXISTS payment_installments (
  id SERIAL PRIMARY KEY,
  plan_ref VARCHAR(50) NOT NULL UNIQUE,
  penalty_id INTEGER NOT NULL REFERENCES enforcement_fines(id) ON DELETE CASCADE,
  schedule JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'defaulted', 'cancelled')),
  defaulted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment log per plan for idempotent installment payment recording
-- ([{ payment_reference, amount, applied_at }], appended by
-- finePayments.recordInstallmentPayment).
ALTER TABLE payment_installments ADD COLUMN IF NOT EXISTS recorded_payments JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_payment_installments_active ON payment_installments (status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  receipt_number VARCHAR(30) NOT NULL UNIQUE,
  rrr VARCHAR(20),
  penalty_id INTEGER REFERENCES enforcement_fines(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  payer_email VARCHAR(255),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_rrr ON receipts (rrr) WHERE rrr IS NOT NULL;

CREATE TABLE IF NOT EXISTS refund_requests (
  id SERIAL PRIMARY KEY,
  refund_ref VARCHAR(50) NOT NULL UNIQUE,
  rrr VARCHAR(20),
  penalty_id INTEGER REFERENCES enforcement_fines(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  reason TEXT NOT NULL,
  requested_by VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'processed')),
  decided_by VARCHAR(255),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests (status) WHERE status = 'requested';

-- ─── Receipt numbering sequence ─────────────────────────────────────────────
-- Replaces the racy COUNT(*)+1 receipt number allocation in
-- finePayments.nextReceiptNumber. Values are formatted NDPC-RCT-YYYY-#####.
CREATE SEQUENCE IF NOT EXISTS ndsep_receipt_number_seq;
