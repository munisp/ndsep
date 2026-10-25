-- Migration 0126: final DROP of the retired plaintext subject_ref columns.
--
-- Round-10 closer step completing the sequence started by 0105 (hash
-- backfill) and 0122 (redact + write-block trigger):
--   - server/routers/ninIdentity.ts no longer references subject_ref anywhere
--     (removed from all INSERT column lists and from the legacy dual-match
--     fallback arms; every lookup is hash-only via subject_ref_hash).
--   - 0122 already verified no row carried plaintext and forced
--     NEW.subject_ref := NULL via trg_block_plaintext_subject_ref.
--
-- This migration therefore, for BOTH identity_verifications and
-- verification_audit_log:
--   1. GUARD: refuses to proceed if any row still holds a non-NULL
--      subject_ref (nothing should — 0122 redacted and write-blocked — but
--      the guard makes the drop non-destructive by construction).
--   2. DROPS the write-block trigger trg_block_plaintext_subject_ref (its
--      only purpose was protecting a column that no longer exists).
--   3. DROPS the now-inert legacy partial unique index on
--      (subject_type, subject_ref) created by 0093
--      (idx_identity_verifications_active_subject), if present; the hash
--      index idx_identity_verifications_active_subject_hash (0122) carries
--      the uniqueness invariant.
--   4. DROPS COLUMN subject_ref.
--   5. DROPS the shared block_plaintext_subject_ref() trigger function once
--      no table uses it anymore.
--
-- Idempotent: guards are existence-checked; DROP ... IF EXISTS throughout;
-- re-running after success is a no-op. PostgreSQL only.

-- ─── 1. Guard: no plaintext may remain in either table ───────────────────────
DO $$
DECLARE
  bad BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'identity_verifications' AND column_name = 'subject_ref'
  ) THEN
    SELECT count(*) INTO bad FROM identity_verifications WHERE subject_ref IS NOT NULL;
    IF bad > 0 THEN
      RAISE EXCEPTION '0126 abort: % identity_verifications rows still hold plaintext subject_ref — run 0122 redaction first', bad;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'verification_audit_log' AND column_name = 'subject_ref'
  ) THEN
    SELECT count(*) INTO bad FROM verification_audit_log WHERE subject_ref IS NOT NULL;
    IF bad > 0 THEN
      RAISE EXCEPTION '0126 abort: % verification_audit_log rows still hold plaintext subject_ref — run 0122 redaction first', bad;
    END IF;
  END IF;
END $$;

-- ─── 2. Drop the write-block triggers (their protected column is going away) ─
DROP TRIGGER IF EXISTS trg_block_plaintext_subject_ref ON identity_verifications;
DROP TRIGGER IF EXISTS trg_block_plaintext_subject_ref ON verification_audit_log;

-- ─── 3. Drop the legacy plaintext partial unique index (0093) ────────────────
DROP INDEX IF EXISTS idx_identity_verifications_active_subject;

-- ─── 4. Drop the columns ─────────────────────────────────────────────────────
ALTER TABLE identity_verifications DROP COLUMN IF EXISTS subject_ref;
ALTER TABLE verification_audit_log DROP COLUMN IF EXISTS subject_ref;

-- ─── 5. Drop the shared trigger function ─────────────────────────────────────
DROP FUNCTION IF EXISTS block_plaintext_subject_ref();
