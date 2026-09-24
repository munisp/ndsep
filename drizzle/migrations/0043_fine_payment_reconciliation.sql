-- Migration: Fine payment & reconciliation — Remita-style RRR flow (gap 12)
-- RRR code generation, gateway reconciliation, installment plans with
-- auto-default detection, receipts (NDPC-RCT-YYYY-#####) and refunds.

-- RRR (Remita Retrieval Reference) codes generated per penalty.
-- Lifecycle: generated -> paid | expired | cancelled.
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

CREATE INDEX IF NOT EXISTS idx_payment_rrr_penalty
  ON payment_rrr_codes (penalty_id);

CREATE INDEX IF NOT EXISTS idx_payment_rrr_pending
  ON payment_rrr_codes (status)
  WHERE status = 'generated';

-- Daily reconciliation batch results. Rows link RRR payments to penalties;
-- rows with match_status='unmatched' form the unmatched queue for manual
-- review.
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

CREATE INDEX IF NOT EXISTS idx_payment_recon_batch
  ON payment_reconciliations (batch_date, match_status);

-- Installment plans against a penalty. `schedule` is a JSONB array:
--   [{ "seq": 1, "due_date": "2026-01-31", "amount": 500000.00,
--      "status": "pending|paid|overdue", "paid_at": null }, ...]
-- Auto-default detection marks the plan 'defaulted' when any installment is
-- overdue past the grace window.
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

CREATE INDEX IF NOT EXISTS idx_payment_installments_active
  ON payment_installments (status)
  WHERE status = 'active';

-- Official payment receipts. receipt_number format: NDPC-RCT-YYYY-#####.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_rrr
  ON receipts (rrr)
  WHERE rrr IS NOT NULL;

-- Refund requests with an approval workflow:
-- requested -> approved | rejected -> processed.
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

CREATE INDEX IF NOT EXISTS idx_refund_requests_status
  ON refund_requests (status)
  WHERE status = 'requested';
