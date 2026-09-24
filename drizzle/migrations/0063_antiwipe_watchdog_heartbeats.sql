-- Migration: Anti-wipe filesystem watchdog heartbeats
-- workers/python/antiwipe_watchdog.py appends one row per check cycle with the
-- integrity results. The row stream is itself append-only: a gap in
-- heartbeats, or a run of status != 'ok', is an alertable condition.
-- Depends on antiwipe_block_mutation() from 0060_antiwipe_evidence_vault.sql.

CREATE TABLE IF NOT EXISTS watchdog_heartbeats (
  id              BIGSERIAL PRIMARY KEY,
  worker_id       TEXT NOT NULL,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  vault_files     INTEGER,
  vault_verified  INTEGER,
  canaries_ok     INTEGER,
  canaries_failed INTEGER,
  ledger_head_hash TEXT,
  ledger_ok       BOOLEAN,
  status          TEXT NOT NULL,               -- ok | degraded | integrity_failure
  details         JSONB
);

CREATE INDEX IF NOT EXISTS idx_watchdog_heartbeats_checked_at
  ON watchdog_heartbeats (checked_at);

DROP TRIGGER IF EXISTS trg_watchdog_heartbeats_no_update ON watchdog_heartbeats;
CREATE TRIGGER trg_watchdog_heartbeats_no_update
  BEFORE UPDATE ON watchdog_heartbeats
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_watchdog_heartbeats_no_delete ON watchdog_heartbeats;
CREATE TRIGGER trg_watchdog_heartbeats_no_delete
  BEFORE DELETE ON watchdog_heartbeats
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();
