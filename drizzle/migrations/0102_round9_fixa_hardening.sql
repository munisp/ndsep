-- ============================================================================
-- 0102: Round-9 FIX-A cross-cutting schema hardening (idempotent)
--
--  a. dual_control_requests: add 'consumed' terminal status so an approved
--     request can be marked as executed (waiver application, etc.).
--  b. publication workbench: round-scoped approvals + correction sub-pipeline.
--  c. enforcement_notices: dual-control columns for publishNotice.
--  d. refund_payouts: real payout queue for fine refund decisions.
--  e. organizations: DCPMI classification on the registration record.
--  f. verified_revenues: dual-attestation officer identity columns.
-- ============================================================================

-- ─── a. dual_control_requests: 'consumed' status ─────────────────────────────
ALTER TABLE dual_control_requests
  DROP CONSTRAINT IF EXISTS dual_control_requests_status_check;
ALTER TABLE dual_control_requests
  ADD CONSTRAINT dual_control_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'consumed'));

-- ─── b. publication workbench: round-scoped approvals ────────────────────────
ALTER TABLE publication_documents
  ADD COLUMN IF NOT EXISTS approval_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correction_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_body_redacted TEXT,
  ADD COLUMN IF NOT EXISTS pending_public_note TEXT,
  ADD COLUMN IF NOT EXISTS pending_redaction_task_id INTEGER;

ALTER TABLE publication_approvals
  ADD COLUMN IF NOT EXISTS approval_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded BOOLEAN NOT NULL DEFAULT FALSE;

-- Approvals are now unique per (document, stage, approver, round) and may also
-- record the 'correction' stage.
ALTER TABLE publication_approvals
  DROP CONSTRAINT IF EXISTS publication_approvals_document_id_stage_approver_id_key;
ALTER TABLE publication_approvals
  DROP CONSTRAINT IF EXISTS publication_approvals_stage_check;
ALTER TABLE publication_approvals
  ADD CONSTRAINT publication_approvals_stage_check
  CHECK (stage IN ('legal_review', 'publication', 'correction'));
CREATE UNIQUE INDEX IF NOT EXISTS publication_approvals_doc_stage_approver_round_uniq
  ON publication_approvals (document_id, stage, approver_id, approval_round);

CREATE INDEX IF NOT EXISTS idx_publication_approvals_current_round
  ON publication_approvals (document_id, stage, approval_round)
  WHERE superseded = FALSE;

-- ─── c. enforcement_notices: publish dual-control columns ────────────────────
ALTER TABLE enforcement_notices
  ADD COLUMN IF NOT EXISTS publish_requested_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_first_approver VARCHAR(255),
  ADD COLUMN IF NOT EXISTS publish_second_approver VARCHAR(255);

-- ─── d. refund_payouts: real payout queue ────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_payouts (
  id SERIAL PRIMARY KEY,
  refund_ref VARCHAR(64) NOT NULL UNIQUE,
  fine_id INTEGER NOT NULL,
  organization_id INTEGER,
  amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'confirmed', 'failed')),
  provider_ref VARCHAR(255),
  requested_by VARCHAR(255),
  confirmed_by VARCHAR(255),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_payouts_fine ON refund_payouts (fine_id);
CREATE INDEX IF NOT EXISTS idx_refund_payouts_status ON refund_payouts (status);

-- ─── e. organizations: DCPMI classification on the registration record ───────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_dcpmi BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dcpmi_basis TEXT;

-- ─── g. tribunal_bundles: export artifact hash (real export record) ─────────
ALTER TABLE tribunal_bundles
  ADD COLUMN IF NOT EXISTS export_artifact_hash TEXT;

-- ─── f. verified_revenues: dual-attestation officer identity ─────────────────
ALTER TABLE verified_revenues
  ADD COLUMN IF NOT EXISTS attested_by_1 INTEGER,
  ADD COLUMN IF NOT EXISTS attested_by_2 INTEGER,
  ADD COLUMN IF NOT EXISTS attested_at_1 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attested_at_2 TIMESTAMPTZ;
