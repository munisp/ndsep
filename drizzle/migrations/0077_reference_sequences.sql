-- Migration 0077: Per-year DB-sequence reference numbers + consent-propagation
-- security columns.
--
-- Replaces Date.now()-suffix reference generation (collision-prone under
-- concurrency) with Postgres sequences, following the FOIA pattern
-- (0051: foia_requests_ref_seq -> FOIA-YYYY-#####) and the receipt pattern
-- (0075: ndsep_receipt_number_seq -> NDPC-RCT-YYYY-#####).
--
-- Idempotent: safe to run repeatedly.

-- WBR-YYYY-#####  whistleblower reports (phase12Features, whistleblowerChannel)
CREATE SEQUENCE IF NOT EXISTS ndsep_wb_report_ref_seq START 1;
-- REF-YYYY-#####  regulator reconciliation referrals (regulatorReconciliation)
CREATE SEQUENCE IF NOT EXISTS ndsep_referral_ref_seq START 1;
-- ENG-YYYY-#####  DPO marketplace engagements (dpoMarketplace)
CREATE SEQUENCE IF NOT EXISTS ndsep_engagement_ref_seq START 1;
-- INS-YYYY-#####  installment plans (finePayments)
CREATE SEQUENCE IF NOT EXISTS ndsep_installment_plan_ref_seq START 1;
-- RFD-YYYY-#####  refund requests (finePayments)
CREATE SEQUENCE IF NOT EXISTS ndsep_refund_ref_seq START 1;

-- ─── Consent propagation hardening (gap 17) ─────────────────────────────────
-- subject_ref is stored encrypted (application-layer encryptField); because
-- AES-GCM uses random IVs, ciphertext is not equality-searchable, so a
-- deterministic SHA-256 lookup hash is kept alongside for the
-- same-subject/same-purpose/same-day withdrawal idempotency check.
ALTER TABLE withdrawal_events ADD COLUMN IF NOT EXISTS subject_ref_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_withdrawal_events_subject_hash
  ON withdrawal_events (subject_ref_hash);

-- markNotified dispatch bookkeeping: HTTP status / failure note from the
-- best-effort POST to the processor's ack_endpoint_url.
ALTER TABLE propagation_records ADD COLUMN IF NOT EXISTS last_dispatch_status INTEGER;
ALTER TABLE propagation_records ADD COLUMN IF NOT EXISTS last_dispatch_note TEXT;

-- ─── Appeals due process grounding ──────────────────────────────────────────
-- The appeal window runs from the penalty decision/served date, not the row
-- creation time. decision_date = when the Commission issued the decision;
-- served_date = when it was served on the organisation (window starts at
-- service where known). Historical rows fall back to created_at.
ALTER TABLE financial_penalties ADD COLUMN IF NOT EXISTS decision_date TIMESTAMPTZ;
ALTER TABLE financial_penalties ADD COLUMN IF NOT EXISTS served_date TIMESTAMPTZ;
UPDATE financial_penalties SET decision_date = created_at WHERE decision_date IS NULL;

-- Nigeria has no Data Protection Tribunal; NDPA 2023 appeals/judicial review
-- lie to the Federal High Court. Column name retained for compatibility.
DO $$
BEGIN
  IF to_regclass('tribunal_escalations') IS NOT NULL THEN
    ALTER TABLE tribunal_escalations
      ALTER COLUMN tribunal_name SET DEFAULT 'Federal High Court (judicial review)';
  END IF;
END $$;

-- ─── Regulator dashboard scoping ────────────────────────────────────────────
-- Binds a regulator-role user to a sector regulator code (NDPC/CBN/NCC/...)
-- so regulatorReconciliation.regulatorDashboard can restrict non-admin
-- callers to their own regulator's slice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS regulator_code VARCHAR(16);

-- ─── DPCO billing hardening ─────────────────────────────────────────────────
-- Payment references from a DB sequence (was PAY-Date.now()-suffix).
CREATE SEQUENCE IF NOT EXISTS ndsep_dpco_payment_ref_seq START 1;

-- 'partially_paid' invoice status for cumulative partial-payment tracking
-- (billing.recordPayment previously flipped any payment straight to 'paid').
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'dpco_invoice_status' AND e.enumlabel = 'partially_paid'
  ) THEN
    ALTER TYPE dpco_invoice_status ADD VALUE 'partially_paid';
  END IF;
END $$;

-- Align the payment-method enum with the router's accepted methods.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'dpco_payment_method' AND e.enumlabel = 'mobile_money'
  ) THEN
    ALTER TYPE dpco_payment_method ADD VALUE 'mobile_money';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'dpco_payment_method' AND e.enumlabel = 'crypto'
  ) THEN
    ALTER TYPE dpco_payment_method ADD VALUE 'crypto';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'dpco_payment_method' AND e.enumlabel = 'cash'
  ) THEN
    ALTER TYPE dpco_payment_method ADD VALUE 'cash';
  END IF;
END $$;
