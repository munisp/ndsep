-- Migration 0086: Settlement negotiation workflow for enforcement cases
--
-- NDPA 2023 settlement lifecycle:
--   proposal -> counter -> agreement -> approval -> active
--     -> fulfilled | defaulted | void
--
--   settlements            one row per negotiation; fine linkage by
--                          fine_reference (finePayments / 0075
--                          enforcement_fines.fine_reference).
--   settlement_terms       versioned structured terms (monetary amount,
--                          non-monetary obligations, instalment schedule,
--                          confidentiality flag + mandatory public
--                          transparency rationale when confidential).
--   settlement_approvals   maker-checker approval chain: two DISTINCT
--                          approvers, neither the proposer; the FINAL
--                          approval must be commissioner level
--                          (approval_level = 'commissioner').
--   settlement_instalments materialised instalment schedule; each entry is
--                          posted to TigerBeetle via the
--                          middlewareExtensions bridge with an explicit
--                          ledger_post_status ('UNCONFIGURED' when the bridge
--                          is absent — never a silent fake success).
--
-- Waiver/reduction rows (settlements.reduction_amount) require a documented
-- legal basis and are routed through the 0080 dual_control_requests queue
-- (action 'fine_settlement') by the router.
--
-- Idempotent: safe to run repeatedly.

CREATE SEQUENCE IF NOT EXISTS ndsep_settlement_ref_seq;

CREATE TABLE IF NOT EXISTS settlements (
  id                  BIGSERIAL PRIMARY KEY,
  settlement_ref      TEXT NOT NULL UNIQUE,        -- NDPC-SET-YYYY-#####
  case_ref            TEXT NOT NULL,               -- enforcement case reference
  fine_reference      TEXT,                        -- link to enforcement_fines.fine_reference
  fine_id             INTEGER REFERENCES enforcement_fines(id) ON DELETE SET NULL,
  org_id              INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'proposal'
                      CHECK (status IN
                        ('proposal', 'counter', 'agreement', 'approval',
                         'active', 'fulfilled', 'defaulted', 'void')),
  current_terms_version INTEGER NOT NULL DEFAULT 1,
  proposed_by         TEXT NOT NULL,               -- officer who opened negotiation
  respondent_name     TEXT,                        -- data controller/processor contact
  respondent_email    TEXT,
  -- waiver/reduction (requires legal_basis + dual control via router):
  original_amount     NUMERIC(16, 2),
  reduction_amount    NUMERIC(16, 2) NOT NULL DEFAULT 0,
  reduction_legal_basis TEXT,
  default_reason      TEXT,
  defaulted_at        TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  fulfilled_at        TIMESTAMPTZ,
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlements_reduction_nonnegative CHECK (reduction_amount >= 0),
  CONSTRAINT settlements_reduction_requires_basis
    CHECK (reduction_amount = 0 OR reduction_legal_basis IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_settlements_case_ref
  ON settlements (case_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_fine_reference
  ON settlements (fine_reference) WHERE fine_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_status
  ON settlements (status) WHERE status IN ('proposal', 'counter', 'agreement', 'approval', 'active');
-- At most one non-terminal settlement per fine.
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_one_live_per_fine
  ON settlements (fine_id)
  WHERE fine_id IS NOT NULL
    AND status IN ('proposal', 'counter', 'agreement', 'approval', 'active');

CREATE TABLE IF NOT EXISTS settlement_terms (
  id                       BIGSERIAL PRIMARY KEY,
  settlement_id            BIGINT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  version                  INTEGER NOT NULL,
  monetary_amount          NUMERIC(16, 2) NOT NULL CHECK (monetary_amount >= 0),
  currency                 VARCHAR(3) NOT NULL DEFAULT 'NGN',
  non_monetary_obligations JSONB NOT NULL DEFAULT '[]',  -- string[]
  instalment_schedule      JSONB NOT NULL DEFAULT '[]',  -- [{seq, dueDate, amount}]
  confidentiality_flag     BOOLEAN NOT NULL DEFAULT false,
  transparency_rationale   TEXT,                         -- mandatory when confidential
  is_counter               BOOLEAN NOT NULL DEFAULT false,
  proposed_by              TEXT NOT NULL,
  proposed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlement_terms_confidential_needs_rationale
    CHECK (confidentiality_flag = false
           OR (transparency_rationale IS NOT NULL
               AND length(btrim(transparency_rationale)) >= 20))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_terms_version
  ON settlement_terms (settlement_id, version);

CREATE TABLE IF NOT EXISTS settlement_approvals (
  id             BIGSERIAL PRIMARY KEY,
  settlement_id  BIGINT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  approver       TEXT NOT NULL,
  approval_level TEXT NOT NULL
                 CHECK (approval_level IN ('officer', 'commissioner')),
  decision       TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason         TEXT,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_approvals_settlement
  ON settlement_approvals (settlement_id, decided_at);
-- An approver decides at most once per settlement (distinctness enforced here;
-- "not the proposer" and "final must be commissioner" enforced by the router).
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_approvals_distinct
  ON settlement_approvals (settlement_id, approver);

CREATE TABLE IF NOT EXISTS settlement_instalments (
  id                BIGSERIAL PRIMARY KEY,
  settlement_id     BIGINT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  due_date          TIMESTAMPTZ NOT NULL,
  amount            NUMERIC(16, 2) NOT NULL CHECK (amount > 0),
  currency          VARCHAR(3) NOT NULL DEFAULT 'NGN',
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN
                      ('scheduled', 'posted', 'partial', 'paid', 'overdue', 'waived')),
  amount_paid       NUMERIC(16, 2) NOT NULL DEFAULT 0,
  -- TigerBeetle bridge outcome — explicit, never silently faked:
  ledger_post_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (ledger_post_status IN
                      ('pending', 'posted', 'skipped_non_usd',
                       'UNCONFIGURED', 'failed')),
  ledger_ref        TEXT,
  ledger_error      TEXT,
  payment_reference VARCHAR(255),             -- idempotency anchor for recordInstalmentPayment
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_instalments_seq
  ON settlement_instalments (settlement_id, seq);
-- A payment reference may be applied exactly once per settlement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_instalments_payment_ref
  ON settlement_instalments (settlement_id, payment_reference)
  WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_instalments_due
  ON settlement_instalments (due_date)
  WHERE status IN ('scheduled', 'posted', 'partial', 'overdue');
