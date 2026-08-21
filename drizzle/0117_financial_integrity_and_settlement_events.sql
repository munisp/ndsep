-- Mission-critical funds-flow integrity controls.
-- This migration is additive and preserves existing financial-ledger history.

ALTER TABLE financial_ledger
  ADD COLUMN IF NOT EXISTS external_reference VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_fulfilment TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS amount_minor BIGINT;

-- Legacy numeric values are retained for read compatibility. New code must use
-- amount_minor (integer minor units) and a three-character ISO currency.
UPDATE financial_ledger
SET amount_minor = ROUND(amount)::BIGINT
WHERE amount_minor IS NULL;

ALTER TABLE financial_ledger
  ALTER COLUMN amount_minor SET NOT NULL;

ALTER TABLE financial_ledger
  ADD CONSTRAINT financial_ledger_amount_minor_positive
    CHECK (amount_minor > 0),
  ADD CONSTRAINT financial_ledger_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX IF NOT EXISTS financial_ledger_external_reference_unique
  ON financial_ledger (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_ledger_mojaloop_id_idx
  ON financial_ledger (mojaloop_id)
  WHERE mojaloop_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_settlement_events (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  provider_event_id VARCHAR(128) NOT NULL,
  transfer_reference VARCHAR(128) NOT NULL,
  transfer_state VARCHAR(32) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_result VARCHAR(32) NOT NULL DEFAULT 'received',
  error_detail TEXT,
  CONSTRAINT payment_settlement_events_provider_event_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT payment_settlement_events_state_check CHECK (transfer_state IN ('COMMITTED', 'ABORTED', 'RESERVED'))
);

CREATE INDEX IF NOT EXISTS payment_settlement_events_transfer_received_idx
  ON payment_settlement_events (transfer_reference, received_at DESC);

CREATE INDEX IF NOT EXISTS payment_settlement_events_unprocessed_idx
  ON payment_settlement_events (received_at)
  WHERE processed_at IS NULL;

-- Database-level transition protection: terminal settled/failed transactions may
-- never be overwritten by a contradictory provider callback.
CREATE OR REPLACE FUNCTION financial_ledger_prevent_illegal_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('settled', 'failed', 'reversed') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'illegal financial ledger status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'financial ledger amount and currency are immutable after creation'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS financial_ledger_integrity_guard ON financial_ledger;
CREATE TRIGGER financial_ledger_integrity_guard
BEFORE UPDATE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION financial_ledger_prevent_illegal_status_transition();

CREATE TABLE IF NOT EXISTS financial_transfer_outbox (
  id BIGSERIAL PRIMARY KEY,
  transfer_reference VARCHAR(128) NOT NULL UNIQUE,
  transfer_kind VARCHAR(16) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payload JSONB NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  tigerbeetle_transfer_id VARCHAR(128),
  mojaloop_transfer_id VARCHAR(128),
  dispatched_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_transfer_outbox_kind_check CHECK (transfer_kind IN ('NIP', 'RTGS', 'SWIFT')),
  CONSTRAINT financial_transfer_outbox_state_check CHECK (state IN ('pending', 'leased', 'dispatched', 'settled', 'failed', 'dead_letter'))
);

CREATE INDEX IF NOT EXISTS financial_transfer_outbox_dispatch_idx
  ON financial_transfer_outbox (state, available_at)
  WHERE state IN ('pending', 'leased');

CREATE OR REPLACE FUNCTION financial_transfer_outbox_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.state IN ('settled', 'dead_letter') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'terminal financial outbox state cannot transition from % to %', OLD.state, NEW.state
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS financial_transfer_outbox_integrity_guard ON financial_transfer_outbox;
CREATE TRIGGER financial_transfer_outbox_integrity_guard
BEFORE UPDATE ON financial_transfer_outbox
FOR EACH ROW EXECUTE FUNCTION financial_transfer_outbox_guard();

-- API retry protection. The caller must supply an idempotency UUID; the actor,
-- key, and canonical request fingerprint identify exactly one accepted intent.
ALTER TABLE financial_transfer_outbox
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);

ALTER TABLE financial_transfer_outbox
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_fingerprint SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS financial_transfer_outbox_actor_idempotency_unique
  ON financial_transfer_outbox (actor_id, idempotency_key);

-- A timeout or broken acknowledgement is never a reason to retry money movement.
-- Such messages are quarantined until both authoritative provider reference
-- lookups establish the safe next action.
ALTER TABLE financial_transfer_outbox
  DROP CONSTRAINT IF EXISTS financial_transfer_outbox_state_check;
ALTER TABLE financial_transfer_outbox
  ADD CONSTRAINT financial_transfer_outbox_state_check
    CHECK (state IN ('pending', 'leased', 'dispatched', 'settled', 'failed', 'dead_letter', 'reconciliation_required'));

CREATE TABLE IF NOT EXISTS financial_provider_reconciliation (
  id BIGSERIAL PRIMARY KEY,
  transfer_reference VARCHAR(128) NOT NULL REFERENCES financial_transfer_outbox(transfer_reference),
  provider VARCHAR(32) NOT NULL,
  observed_state VARCHAR(32) NOT NULL,
  response_sha256 CHAR(64),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action VARCHAR(32) NOT NULL,
  detail TEXT,
  CONSTRAINT financial_provider_reconciliation_provider_check CHECK (provider IN ('tigerbeetle', 'mojaloop'))
);
CREATE INDEX IF NOT EXISTS financial_provider_reconciliation_reference_checked_idx
  ON financial_provider_reconciliation (transfer_reference, checked_at DESC);
