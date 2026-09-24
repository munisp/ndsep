-- Migration: Anti-wipe backup manifest + ransomware canary registry
-- backup_manifest records every backup with its SHA-256 so a "successful"
-- backup job that actually wrote garbage (or was swapped by an attacker) is
-- caught at verify time and before restore. canary_files registers tripwire
-- files with known hashes; any modification/deletion of a canary is an early
-- ransomware/wipe signal.
-- Depends on antiwipe_block_mutation() from 0060_antiwipe_evidence_vault.sql.

CREATE TABLE IF NOT EXISTS backup_manifest (
  backup_id    TEXT PRIMARY KEY,               -- e.g. ndsep_db_20260411_020000
  type         TEXT NOT NULL DEFAULT 'postgres',  -- postgres | vault | config
  path         TEXT NOT NULL,                  -- where the dump artifact lives
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  size_bytes   BIGINT,
  sha256       TEXT,                           -- sha256 of the dump artifact
  verified     BOOLEAN NOT NULL DEFAULT false,
  verified_at  TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_manifest_created_at
  ON backup_manifest (created_at);

CREATE TABLE IF NOT EXISTS canary_files (
  path            TEXT PRIMARY KEY,            -- absolute path of the tripwire file
  sha256          TEXT NOT NULL,               -- known-good hash at write time
  directory       TEXT NOT NULL,               -- watched dir it was dropped into
  written_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'ok'   -- ok | modified | missing
);

-- Verification/completion flips fields forward-only; identity columns frozen.
CREATE OR REPLACE FUNCTION antiwipe_backup_guard_update() RETURNS trigger AS $$
BEGIN
  IF NEW.backup_id IS NOT DISTINCT FROM OLD.backup_id
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.path IS NOT DISTINCT FROM OLD.path
     AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND (OLD.verified = false OR NEW.verified = true) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'antiwipe: backup_manifest updates limited to completion/verification fields';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_backup_manifest_guard_update ON backup_manifest;
CREATE TRIGGER trg_backup_manifest_guard_update
  BEFORE UPDATE ON backup_manifest
  FOR EACH ROW EXECUTE FUNCTION antiwipe_backup_guard_update();

DROP TRIGGER IF EXISTS trg_backup_manifest_no_delete ON backup_manifest;
CREATE TRIGGER trg_backup_manifest_no_delete
  BEFORE DELETE ON backup_manifest
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

-- Canary rows may be refreshed (new hash on rewrite) and their status updated
-- by checkCanaries(); deletion of the registry row is forbidden so an attacker
-- cannot simply unregister a tripwire before removing it.
DROP TRIGGER IF EXISTS trg_canary_files_no_delete ON canary_files;
CREATE TRIGGER trg_canary_files_no_delete
  BEFORE DELETE ON canary_files
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();
