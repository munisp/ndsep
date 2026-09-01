-- Durable NIP/RTGS payment command lifecycle.
-- TigerBeetle remains the double-entry authority; this table is the PostgreSQL
-- command/projection ledger that prevents loss of downstream work after restart.

ALTER TYPE rtgs_status ADD VALUE IF NOT EXISTS 'pending_confirmation';

CREATE TYPE payment_command_kind AS ENUM ('nip', 'rtgs');
CREATE TYPE payment_command_status AS ENUM (
    'pending_ledger', 'processing_ledger', 'pending_settlement', 'processing_settlement',
    'pending_confirmation', 'completed', 'failed'
);

CREATE TABLE payment_commands (
    id UUID PRIMARY KEY,
    payment_kind payment_command_kind NOT NULL,
    payment_reference VARCHAR(64) NOT NULL UNIQUE,
    nip_transaction_id INTEGER REFERENCES nip_transactions(id) ON DELETE RESTRICT,
    rtgs_transaction_id INTEGER REFERENCES rtgs_transactions(id) ON DELETE RESTRICT,
    status payment_command_status NOT NULL DEFAULT 'pending_ledger',
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
    debit_account VARCHAR(128) NOT NULL,
    credit_account VARCHAR(128) NOT NULL,
    tigerbeetle_transaction_id VARCHAR(128),
    mojaloop_reference VARCHAR(128),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_commands_target_shape CHECK (
        (payment_kind = 'nip' AND nip_transaction_id IS NOT NULL AND rtgs_transaction_id IS NULL)
        OR (payment_kind = 'rtgs' AND rtgs_transaction_id IS NOT NULL AND nip_transaction_id IS NULL)
    ),
    CONSTRAINT payment_commands_external_ids CHECK (
        tigerbeetle_transaction_id IS NULL OR char_length(tigerbeetle_transaction_id) BETWEEN 1 AND 128
    ),
    CONSTRAINT payment_commands_mojaloop_reference CHECK (
        mojaloop_reference IS NULL OR char_length(mojaloop_reference) BETWEEN 1 AND 128
    )
);

CREATE UNIQUE INDEX payment_commands_nip_transaction_unique
    ON payment_commands (nip_transaction_id)
    WHERE nip_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX payment_commands_rtgs_transaction_unique
    ON payment_commands (rtgs_transaction_id)
    WHERE rtgs_transaction_id IS NOT NULL;

CREATE INDEX payment_commands_due_idx
    ON payment_commands (status, next_attempt_at, created_at)
    WHERE status IN ('pending_ledger', 'pending_settlement');

CREATE INDEX payment_commands_lease_idx
    ON payment_commands (status, lease_expires_at)
    WHERE status IN ('processing_ledger', 'processing_settlement');

CREATE INDEX payment_commands_mojaloop_reference_idx
    ON payment_commands (mojaloop_reference)
    WHERE mojaloop_reference IS NOT NULL;
