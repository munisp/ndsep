-- Migration 0105: Round-9 FIX-B — keyed-hash subject references for the NIN
-- identity module.
--
-- Problem: identity_verifications.subject_ref and verification_audit_log
-- .subject_ref were plaintext equality keys; the keyed HMAC used by the
-- application (NIN_HMAC_KEY) had no persisted counterpart to look up.
--
-- Fix: add subject_ref_hash columns and backfill them.
--
-- Transitional note: a SQL migration cannot compute the application's keyed
-- HMAC (NIN_HMAC_KEY lives in the application environment), so the backfill
-- uses unkeyed SHA-256 as a LEGACY form. The application writes the keyed
-- HMAC for all new rows and matches EITHER form on read
-- (subject_ref_hash IN (keyed, legacy_sha256)), so backfilled rows remain
-- findable; rows are upgraded to the keyed form on their next write.
-- Requires pgcrypto for digest().
--
-- Idempotent: IF NOT EXISTS guards + IS NULL backfill predicate.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS subject_ref_hash VARCHAR(64);
ALTER TABLE verification_audit_log
  ADD COLUMN IF NOT EXISTS subject_ref_hash VARCHAR(64);

-- Legacy backfill (unkeyed SHA-256; transitional — see header note).
UPDATE identity_verifications
SET subject_ref_hash = encode(digest(subject_ref, 'sha256'), 'hex')
WHERE subject_ref_hash IS NULL AND subject_ref IS NOT NULL;

UPDATE verification_audit_log
SET subject_ref_hash = encode(digest(subject_ref, 'sha256'), 'hex')
WHERE subject_ref_hash IS NULL AND subject_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_identity_verifications_subject_hash
  ON identity_verifications (subject_type, subject_ref_hash);
CREATE INDEX IF NOT EXISTS idx_verification_audit_log_subject_hash
  ON verification_audit_log (subject_type, subject_ref_hash);
