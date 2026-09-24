-- Migration: Anti-wipe append-only evidence vault metadata
-- The evidence vault stores write-once, content-addressed evidence files on
-- disk (directory-per-day under EVIDENCE_VAULT_DIR); this table is the
-- tamper-evident metadata index. Rows are keyed by the SHA-256 of the stored
-- content, so any post-write modification is detectable by re-hashing.
-- DELETE is blocked at the database layer by trigger below; UPDATE is blocked
-- except for the one-way sealing transition (sealed: false -> true).

CREATE TABLE IF NOT EXISTS evidence_vault_entries (
  hash          TEXT PRIMARY KEY,              -- sha256 hex of file content
  path          TEXT NOT NULL,                 -- vault-relative path
  size_bytes    BIGINT NOT NULL,
  content_type  TEXT,
  uploader_id   INTEGER,
  uploader_name TEXT,
  case_ref      TEXT,                          -- enforcement case / DSAR / breach ref
  sealed        BOOLEAN NOT NULL DEFAULT false,
  sealed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_vault_entries_case_ref
  ON evidence_vault_entries (case_ref)
  WHERE case_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_vault_entries_created_at
  ON evidence_vault_entries (created_at);

-- ── Append-only enforcement ─────────────────────────────────────────────────
-- Shared guard function: any UPDATE/DELETE on protected anti-wipe tables
-- raises rather than mutating. Legitimate retention actions must go through
-- a privileged DBA role that drops the trigger explicitly (audited separately).
CREATE OR REPLACE FUNCTION antiwipe_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'antiwipe: % on table % is forbidden (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Vault-specific update guard: permits ONLY the one-way seal transition
-- (sealed false -> true with sealed_at set); every other column must be
-- untouched, so content identity can never be rewritten after the fact.
CREATE OR REPLACE FUNCTION antiwipe_vault_guard_update() RETURNS trigger AS $$
BEGIN
  IF NEW.hash IS NOT DISTINCT FROM OLD.hash
     AND NEW.path IS NOT DISTINCT FROM OLD.path
     AND NEW.size_bytes IS NOT DISTINCT FROM OLD.size_bytes
     AND NEW.content_type IS NOT DISTINCT FROM OLD.content_type
     AND NEW.uploader_id IS NOT DISTINCT FROM OLD.uploader_id
     AND NEW.uploader_name IS NOT DISTINCT FROM OLD.uploader_name
     AND NEW.case_ref IS NOT DISTINCT FROM OLD.case_ref
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND OLD.sealed = false AND NEW.sealed = true THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'antiwipe: UPDATE on evidence_vault_entries limited to one-way sealing';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evidence_vault_entries_guard_update ON evidence_vault_entries;
CREATE TRIGGER trg_evidence_vault_entries_guard_update
  BEFORE UPDATE ON evidence_vault_entries
  FOR EACH ROW EXECUTE FUNCTION antiwipe_vault_guard_update();

DROP TRIGGER IF EXISTS trg_evidence_vault_entries_no_delete ON evidence_vault_entries;
CREATE TRIGGER trg_evidence_vault_entries_no_delete
  BEFORE DELETE ON evidence_vault_entries
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();
