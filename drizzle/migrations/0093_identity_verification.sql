-- Migration 0093: Privacy-preserving NIN identity verification.
--
-- Backs server/routers/ninIdentity.ts (NIMC adapter).
--
-- PRIVACY INVARIANT: the raw National Identification Number (NIN) is NEVER
-- persisted. This schema deliberately has no column capable of holding a raw
-- NIN — only:
--   nin_hmac           HMAC-SHA256 of the NIN (keyed, non-reversible)
--   verification_token opaque token returned by NIMC (or a locally generated
--                      UUID when the adapter returns no token)
--   assurance_level    none | basic | nin_verified
--   verified_at/expires_at timestamps (re-verification due after expiry)
-- tests/round8/ninPrivacy.test.ts statically enforces this invariant.
--
-- Biometric/liveness matching against NIMC is an ADAPTER INTERFACE ONLY and
-- is NOT implemented (see ninIdentity.verifyBiometric → NOT_IMPLEMENTED).
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS identity_verifications (
  id                 BIGSERIAL PRIMARY KEY,
  subject_type       TEXT NOT NULL
                     CHECK (subject_type IN ('complainant', 'dsar_requester', 'user')),
  subject_ref        TEXT NOT NULL,            -- complaint ref / DSAR ref / user id
  nin_hmac           VARCHAR(64),              -- HMAC-SHA256(NIN); NULL for 'basic' self-attested rows
  verification_token TEXT,                     -- opaque adapter token; NOT the NIN
  assurance_level    TEXT NOT NULL DEFAULT 'none'
                     CHECK (assurance_level IN ('none', 'basic', 'nin_verified')),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'expired', 'revoked', 'failed')),
  adapter            TEXT,                     -- 'nimc' | 'self_attested'
  adapter_ref        TEXT,                     -- NIMC transaction reference, if returned
  verified_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,              -- re-verification required after this (default +365 days)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active verification per subject; superseded rows are expired/revoked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_verifications_active_subject
  ON identity_verifications (subject_type, subject_ref) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_identity_verifications_nin_hmac
  ON identity_verifications (nin_hmac);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_expiry
  ON identity_verifications (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS verification_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  verification_id BIGINT REFERENCES identity_verifications (id) ON DELETE SET NULL,
  action          TEXT NOT NULL
                  CHECK (action IN
                    ('verify_request', 'verify_success', 'verify_failed',
                     'verify_unconfigured', 'check', 'expired', 'revoked',
                     'biometric_not_implemented')),
  actor           TEXT,                        -- user id/email, or NULL for self-service
  subject_type    TEXT,
  subject_ref     TEXT,
  details         JSONB NOT NULL DEFAULT '{}', -- MUST NOT contain raw NIN (asserted by router + tests)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_audit_log_verification
  ON verification_audit_log (verification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_audit_log_created_at
  ON verification_audit_log (created_at DESC);
