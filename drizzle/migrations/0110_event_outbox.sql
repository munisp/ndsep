-- Migration 0110: durable event outbox + ledger reconciliation queue (round-9)
--
-- (a) event_outbox: persistent outbox for audit/compliance domain events.
--     server/kafka.ts writes here transactionally with the state change and a
--     relay (server/kafka.ts#startOutboxRelay) publishes pending rows to Kafka,
--     marking them published only after broker acknowledgement. This replaces
--     fire-and-forget publishing that silently dropped audit events whenever
--     Kafka was degraded.
--
-- (b) ledger_reconciliation_queue: persistent queue for financial-ledger
--     reconciliation work. TigerBeetle's USD-only proxy cannot record NGN
--     settlement/fine transfers; instead of a log-line that nobody reads, each
--     non-USD (or failed) transfer is enqueued here with an alerting hook and
--     must be explicitly resolved by an operator.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS event_outbox (
  id              BIGSERIAL PRIMARY KEY,
  topic           TEXT NOT NULL,
  partition_key   TEXT,
  payload         JSONB NOT NULL,
  headers         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'published', 'failed', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_dead
  ON event_outbox (created_at)
  WHERE status = 'dead';

CREATE TABLE IF NOT EXISTS ledger_reconciliation_queue (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,               -- non_usd_currency | ledger_write_failed | ledger_mismatch
  currency        TEXT NOT NULL,
  amount          NUMERIC(20, 4) NOT NULL,
  ledger_id       INTEGER,                     -- target TigerBeetle ledger (TB_LEDGER_USD / TB_LEDGER_NGN)
  debit_account   TEXT,
  credit_account  TEXT,
  reference       TEXT,
  transfer_type   TEXT,
  payload         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'resolved', 'escalated')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  alert_sent_at   TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_recon_pending
  ON ledger_reconciliation_queue (created_at)
  WHERE status IN ('pending', 'escalated');
