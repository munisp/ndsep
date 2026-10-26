-- Migration 0145: crypto ransom wallet tracing (round 13, W3 / P0.4).
--
-- Ransomware / breach-enforcement wallet traces via OSIRIS
-- (/api/osint/crypto, proxying blockstream/Blockscout-style explorers):
--
--   ransom_traces   one row per traceWallet call: address, chain (API value
--                   or labelled inference), OFAC flag, full defensive-parse
--                   result payload and the tracing officer. case_id is
--                   nullable — traces can be run ad hoc and later attached
--                   to an enforcement case (attachment is mirrored into the
--                   case timeline by server/routers/ransomTrace.ts, and
--                   OFAC hits additionally land in the hash-chained
--                   audit_ledger).
--
-- Idempotent: safe to re-run. PostgreSQL only.

CREATE TABLE IF NOT EXISTS ransom_traces (
  id              BIGSERIAL PRIMARY KEY,
  case_id         INTEGER REFERENCES enforcement_cases(id) ON DELETE SET NULL,
  address         TEXT NOT NULL,
  chain           TEXT NOT NULL DEFAULT 'unknown',
  ofac_sanctioned BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'ok'
                  CHECK (status IN ('ok', 'unavailable')),
  result          JSONB NOT NULL DEFAULT '{}', -- balance, tx_count, recent_txs, flags
  traced_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ransom_traces_case
  ON ransom_traces (case_id, created_at DESC) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ransom_traces_address
  ON ransom_traces (address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ransom_traces_ofac
  ON ransom_traces (ofac_sanctioned, created_at DESC) WHERE ofac_sanctioned = TRUE;
