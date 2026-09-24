-- Migration 0079: Fix the backup_manifest verify-trigger condition.
--
-- 0062's guard allowed updates whenever (OLD.verified = false OR
-- NEW.verified = true) — which also permitted OLD.verified = true AND
-- NEW.verified = true, i.e. post-verification tampering with completion
-- fields (size_bytes, sha256, notes) on an already-verified backup row.
--
-- Rewritten semantics:
--   * verify transition   : OLD.verified = false AND NEW.verified = true
--                           (identity columns frozen) — the ONLY way verified
--                           may change;
--   * pre-verification    : OLD.verified = false AND NEW.verified = false
--                           completion updates (identity columns frozen);
--   * everything else     : rejected — a verified manifest row is immutable
--                           and verified can never flip back to false.
-- Idempotent: CREATE OR REPLACE is safe to run repeatedly.

CREATE OR REPLACE FUNCTION antiwipe_backup_guard_update() RETURNS trigger AS $$
BEGIN
  -- Identity columns must never change on any update path.
  IF NEW.backup_id IS DISTINCT FROM OLD.backup_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.path IS DISTINCT FROM OLD.path
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'antiwipe: backup_manifest identity columns are immutable';
  END IF;

  -- Verify transition: forward-only (false -> true).
  IF OLD.verified = false AND NEW.verified = true THEN
    RETURN NEW;
  END IF;

  -- Pre-verification completion updates (verified stays false).
  IF OLD.verified = false AND NEW.verified = false THEN
    RETURN NEW;
  END IF;

  -- OLD.verified = true: row is immutable (no post-verification tampering,
  -- no un-verifying).
  RAISE EXCEPTION 'antiwipe: backup_manifest row is immutable once verified; verification is forward-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Re-assert the trigger binding (no-op if already present; skipped entirely
-- on provisions where 0062 has not created backup_manifest yet).
DO $$
BEGIN
  IF to_regclass('backup_manifest') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_backup_manifest_guard_update ON backup_manifest;
    CREATE TRIGGER trg_backup_manifest_guard_update
      BEFORE UPDATE ON backup_manifest
      FOR EACH ROW EXECUTE FUNCTION antiwipe_backup_guard_update();
  END IF;
END $$;
