-- Migration: Anti-wipe hash-chained audit ledger + daily anchors
-- audit_ledger is the tamper-evident, append-only audit chain:
--   entry_hash = sha256(prev_hash || canonical(payload) || created_at)
-- Any rewrite/delete of a historical row breaks every subsequent link, which
-- verify-chain detects and localises. ledger_anchors stores the daily
-- merkle-style root so the whole day can be attested with one hash
-- (optionally mirrored to the external Rust audit_chain worker).
-- Depends on antiwipe_block_mutation() from 0060_antiwipe_evidence_vault.sql.

CREATE TABLE IF NOT EXISTS audit_ledger (
  seq         BIGSERIAL PRIMARY KEY,
  prev_hash   TEXT NOT NULL,
  entry_hash  TEXT NOT NULL UNIQUE,
  payload     JSONB NOT NULL,
  actor       TEXT,
  action      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The chain is traversed in seq order; seq is the PK, so no extra index needed.
CREATE INDEX IF NOT EXISTS idx_audit_ledger_action
  ON audit_ledger (action);

CREATE INDEX IF NOT EXISTS idx_audit_ledger_created_at
  ON audit_ledger (created_at);

CREATE TABLE IF NOT EXISTS ledger_anchors (
  id              BIGSERIAL PRIMARY KEY,
  anchor_date     DATE NOT NULL UNIQUE,        -- one root per UTC day
  root_hash       TEXT NOT NULL,
  first_seq       BIGINT,
  last_seq        BIGINT,
  entry_count     INTEGER NOT NULL,
  external_anchor JSONB,                       -- response from Rust audit_chain worker, if reachable
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Append-only enforcement ─────────────────────────────────────────────────
-- No UPDATE, no DELETE, ever: history may only grow. TRUNCATE is blocked via
-- an event-independent statement trigger as well.
DROP TRIGGER IF EXISTS trg_audit_ledger_no_update ON audit_ledger;
CREATE TRIGGER trg_audit_ledger_no_update
  BEFORE UPDATE ON audit_ledger
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_audit_ledger_no_delete ON audit_ledger;
CREATE TRIGGER trg_audit_ledger_no_delete
  BEFORE DELETE ON audit_ledger
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_audit_ledger_no_truncate ON audit_ledger;
CREATE TRIGGER trg_audit_ledger_no_truncate
  BEFORE TRUNCATE ON audit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_ledger_anchors_no_update ON ledger_anchors;
CREATE TRIGGER trg_ledger_anchors_no_update
  BEFORE UPDATE ON ledger_anchors
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_ledger_anchors_no_delete ON ledger_anchors;
CREATE TRIGGER trg_ledger_anchors_no_delete
  BEFORE DELETE ON ledger_anchors
  FOR EACH ROW EXECUTE FUNCTION antiwipe_block_mutation();

DROP TRIGGER IF EXISTS trg_ledger_anchors_no_truncate ON ledger_anchors;
CREATE TRIGGER trg_ledger_anchors_no_truncate
  BEFORE TRUNCATE ON ledger_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION antiwipe_block_mutation();
