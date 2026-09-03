-- Migration-owned claim/lease fields for the additive webhook retry queue.
-- The canonical webhook_deliveries ledger remains unchanged.

ALTER TABLE webhook_delivery_attempts
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_owner varchar(128),
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE webhook_delivery_attempts
  DROP CONSTRAINT IF EXISTS webhook_delivery_attempt_processing_claim_check;

ALTER TABLE webhook_delivery_attempts
  ADD CONSTRAINT webhook_delivery_attempt_processing_claim_check
  CHECK (
    (
      status = 'processing'
      AND claimed_at IS NOT NULL
      AND claim_token IS NOT NULL
      AND claim_owner IS NOT NULL
      AND claim_expires_at IS NOT NULL
    )
    OR status <> 'processing'
  );

ALTER TABLE webhook_delivery_attempts
  ADD CONSTRAINT webhook_delivery_attempt_terminal_claim_clear_check
  CHECK (
    status NOT IN ('delivered', 'dead')
    OR (
      claim_token IS NULL
      AND claim_owner IS NULL
      AND claim_expires_at IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_attempts_claimable
  ON webhook_delivery_attempts (next_retry_at, id)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_attempts_expired_lease
  ON webhook_delivery_attempts (claim_expires_at, id)
  WHERE status = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_delivery_attempts_claim_token
  ON webhook_delivery_attempts (claim_token)
  WHERE claim_token IS NOT NULL;

-- Exactly one canonical ledger outcome may be recorded for each queue attempt.
-- The column can already exist when the root schema is materialized first, so
-- enforce the migration-owned foreign key separately rather than relying on an
-- ignored inline REFERENCES clause. Like the preceding ALTER TABLE checks, this
-- takes a short DDL lock and must be scheduled through the reviewed migration path.
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS queue_attempt_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'webhook_deliveries'::regclass
      AND conname = 'webhook_deliveries_queue_attempt_id_fk'
  ) THEN
    ALTER TABLE webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_queue_attempt_id_fk
      FOREIGN KEY (queue_attempt_id)
      REFERENCES webhook_delivery_attempts(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_queue_attempt
  ON webhook_deliveries (queue_attempt_id)
  WHERE queue_attempt_id IS NOT NULL;
