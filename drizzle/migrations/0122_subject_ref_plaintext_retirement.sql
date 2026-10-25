-- Migration 0122: retire the plaintext subject_ref transition (identity_verifications).
--
-- FIN-1/FIX-B (migration 0105) added subject_ref_hash (HMAC-SHA256, keyed,
-- trunc(NIN || ':' || MSISDN)) with legacy dual-match reads. Round-10
-- completes the plaintext retirement.
--
-- Code verification (server/routers/ninIdentity.ts, the ONLY writer/reader of
-- these tables — confirmed by repo-wide grep, 2026-10-25): every lookup is
-- hash-primary: `subject_ref_hash = $n OR (subject_ref_hash IS NULL AND
-- subject_ref = $n)`. After this migration the legacy plaintext arm is inert
-- (no row carries plaintext, and the trigger below guarantees none ever will
-- again), so all EFFECTIVE reads are hash-only.
--
-- What this migration does, for BOTH identity_verifications and
-- verification_audit_log:
--   1. GUARD: refuses to proceed (RAISE EXCEPTION) if any row still has
--      plaintext subject_ref WITHOUT subject_ref_hash — such rows would lose
--      their lookup path. (0105 backfilled all pre-existing rows; new writes
--      since then always populate the hash.)
--   2. REDACT: UPDATE ... SET subject_ref = NULL for every remaining
--      plaintext value.
--   3. ENFORCE: a BEFORE INSERT OR UPDATE trigger forces NEW.subject_ref to
--      NULL, so the current code path (which still passes plaintext in its
--      INSERT column list) can never persist plaintext again. This makes the
--      redaction durable WITHOUT requiring a coordinated code deploy.
--
-- Why DROP COLUMN is deliberately deferred:
--   ninIdentity.ts still REFERENCES the subject_ref column in its INSERT
--   column lists and in the legacy dual-match fallback arm. Dropping the
--   column while those references exist would turn every verification write
--   and lookup into a runtime SQL error. The follow-up (owner: ninIdentity.ts)
--   is: remove subject_ref from the INSERT lists, remove the
--   `OR (subject_ref_hash IS NULL AND subject_ref = $n)` fallback arms, then
--   a final migration runs:
--       ALTER TABLE identity_verifications DROP COLUMN IF EXISTS subject_ref;
--       ALTER TABLE verification_audit_log DROP COLUMN IF EXISTS subject_ref;
--       DROP TRIGGER ... ; DROP FUNCTION IF EXISTS block_plaintext_subject_ref();
--   Until then the column exists but is guaranteed all-NULL (redacted at rest
--   + write-blocked), which satisfies the plaintext-erasure requirement.
--
-- Idempotent: existence checks on columns/triggers, redaction is a no-op on
-- re-run, CREATE OR REPLACE function + DROP TRIGGER IF EXISTS. PostgreSQL only.

-- ─── 1. Guard: no plaintext-without-hash rows may be redacted blind ──────────
DO $$
DECLARE
  bad BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'identity_verifications' AND column_name = 'subject_ref'
  ) THEN
    SELECT count(*) INTO bad FROM identity_verifications
     WHERE subject_ref IS NOT NULL AND subject_ref_hash IS NULL;
    IF bad > 0 THEN
      RAISE EXCEPTION '0122 abort: % identity_verifications rows have plaintext subject_ref without subject_ref_hash — backfill the hash (0105 pattern) first', bad;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'verification_audit_log' AND column_name = 'subject_ref'
  ) THEN
    SELECT count(*) INTO bad FROM verification_audit_log
     WHERE subject_ref IS NOT NULL AND subject_ref_hash IS NULL;
    IF bad > 0 THEN
      RAISE EXCEPTION '0122 abort: % verification_audit_log rows have plaintext subject_ref without subject_ref_hash — backfill the hash (0105 pattern) first', bad;
    END IF;
  END IF;
END $$;

-- ─── 2. Allow NULLs, then redact all remaining plaintext ─────────────────────
-- identity_verifications.subject_ref was declared NOT NULL in 0093; NULL-ability
-- is required both for the redaction below and for the write-block trigger.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'identity_verifications'
      AND column_name = 'subject_ref' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE identity_verifications ALTER COLUMN subject_ref DROP NOT NULL;
  END IF;
END $$;

-- Preserve the 0093 uniqueness invariant on the HASH from now on: at most one
-- active verification per (subject_type, subject_ref_hash). The legacy partial
-- unique index on (subject_type, subject_ref) becomes inert (all NULL) after
-- the redaction and is kept only until the final DROP COLUMN migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_verifications_active_subject_hash
  ON identity_verifications (subject_type, subject_ref_hash)
  WHERE status = 'active' AND subject_ref_hash IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'identity_verifications' AND column_name = 'subject_ref'
  ) THEN
    UPDATE identity_verifications
       SET subject_ref = NULL, updated_at = now()
     WHERE subject_ref IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'verification_audit_log' AND column_name = 'subject_ref'
  ) THEN
    UPDATE verification_audit_log
       SET subject_ref = NULL
     WHERE subject_ref IS NOT NULL;
  END IF;
END $$;

-- ─── 3. Write-block trigger: plaintext can never be persisted again ──────────
CREATE OR REPLACE FUNCTION block_plaintext_subject_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Defence in depth: silently discard any plaintext the application layer
  -- still sends. The keyed HMAC in subject_ref_hash is the sole lookup path.
  IF NEW.subject_ref IS NOT NULL THEN
    NEW.subject_ref := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'identity_verifications' AND column_name = 'subject_ref'
  ) THEN
    DROP TRIGGER IF EXISTS trg_block_plaintext_subject_ref ON identity_verifications;
    CREATE TRIGGER trg_block_plaintext_subject_ref
      BEFORE INSERT OR UPDATE ON identity_verifications
      FOR EACH ROW EXECUTE FUNCTION block_plaintext_subject_ref();
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'verification_audit_log' AND column_name = 'subject_ref'
  ) THEN
    DROP TRIGGER IF EXISTS trg_block_plaintext_subject_ref ON verification_audit_log;
    CREATE TRIGGER trg_block_plaintext_subject_ref
      BEFORE INSERT OR UPDATE ON verification_audit_log
      FOR EACH ROW EXECUTE FUNCTION block_plaintext_subject_ref();
  END IF;
END $$;
