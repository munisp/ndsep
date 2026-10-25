-- Migration 0111: anti-wipe hardening — TRUNCATE triggers + sql_drop event trigger
--
-- Round-9 audit found that only audit_ledger / ledger_anchors had BEFORE
-- TRUNCATE triggers (0061). evidence_vault_entries, backup_manifest,
-- canary_files and watchdog_heartbeats blocked UPDATE/DELETE but not TRUNCATE,
-- and nothing blocked DROP TABLE. This migration closes both gaps.
--
-- Depends on antiwipe_block_mutation() from 0060_antiwipe_evidence_vault.sql.
-- Idempotent: DROP TRIGGER IF EXISTS / DROP EVENT TRIGGER IF EXISTS first.

-- ── BEFORE TRUNCATE triggers ────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_evidence_vault_entries_no_truncate ON evidence_vault_entries;
CREATE TRIGGER trg_evidence_vault_entries_no_truncate
  BEFORE TRUNCATE ON evidence_vault_entries
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_backup_manifest_no_truncate ON backup_manifest;
CREATE TRIGGER trg_backup_manifest_no_truncate
  BEFORE TRUNCATE ON backup_manifest
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_canary_files_no_truncate ON canary_files;
CREATE TRIGGER trg_canary_files_no_truncate
  BEFORE TRUNCATE ON canary_files
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_watchdog_heartbeats_no_truncate ON watchdog_heartbeats;
CREATE TRIGGER trg_watchdog_heartbeats_no_truncate
  BEFORE TRUNCATE ON watchdog_heartbeats
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();

-- ── sql_drop event trigger: block DROP of protected evidence tables ─────────
-- Mirrors server/antiwipe/guards.ts PROTECTED_TABLES. Any DROP TABLE /
-- DROP SCHEMA that would remove one of these objects raises an exception,
-- even for superuser sessions (event triggers fire for all roles; only a
-- deliberate session_replication_role-style bypass by a DBA who first drops
-- THIS trigger can remove them — which is itself caught by the trigger list).

CREATE OR REPLACE FUNCTION antiwipe_block_drop() RETURNS event_trigger AS $$
DECLARE
  obj record;
  protected_tables TEXT[] := ARRAY[
    'audit_ledger', 'ledger_anchors', 'evidence_vault_entries',
    'backup_manifest', 'canary_files', 'watchdog_heartbeats',
    'audit_logs', 'breach_incidents', 'financial_penalties'
  ];
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF obj.object_type IN ('table', 'table column')
       AND obj.object_name = ANY (protected_tables) THEN
      RAISE EXCEPTION 'antiwipe: DROP of protected object % (%) is forbidden',
        obj.object_name, obj.object_type;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

DROP EVENT TRIGGER IF EXISTS antiwipe_block_drop_trigger;
CREATE EVENT TRIGGER antiwipe_block_drop_trigger
  ON sql_drop
  EXECUTE FUNCTION antiwipe_block_drop();
