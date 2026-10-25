-- ============================================================================
-- 0117: Round-9 FIN-1 leftovers — sanction-publication dual control +
--       delisting org-proof tokens (idempotent)
--
--  a. dual_control_requests: extend action_type CHECK with
--     'sanction_publication' so sanctionsRegister.publishNotice can queue a
--     maker-checker request (0080 pattern: two DISTINCT approvers, neither
--     being the requester) before a notice goes public.
--  b. delisting_proof_tokens: single-use, expiring, hash-only org-proof
--     tokens issued by an admin AFTER verifying the applicant represents the
--     sanctioned organisation. sanctionsRegister.requestDelisting requires a
--     valid token and consumes it atomically with the request insert.
-- ============================================================================

-- ─── a. dual_control_requests: 'sanction_publication' action type ────────────
ALTER TABLE dual_control_requests
  DROP CONSTRAINT IF EXISTS dual_control_requests_action_type_check;
ALTER TABLE dual_control_requests
  ADD CONSTRAINT dual_control_requests_action_type_check
  CHECK (action_type IN
    ('fine_settlement', 'dpco_approval', 'role_grant',
     'vault_sealing_override', 'sanction_publication'));

-- ─── b. delisting org-proof tokens ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delisting_proof_tokens (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id),
  token_hash       VARCHAR(64) NOT NULL UNIQUE,     -- sha256 hex of the bearer token; plaintext is never stored
  applicant_email  VARCHAR(256) NOT NULL,           -- encrypted at rest by the app layer
  issued_by        VARCHAR(255) NOT NULL,           -- admin who verified org representation
  status           VARCHAR(16) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'consumed', 'revoked')),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delisting_proof_tokens_org
  ON delisting_proof_tokens (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_delisting_proof_tokens_expiry
  ON delisting_proof_tokens (expires_at) WHERE status = 'active';
