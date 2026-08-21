CREATE TABLE IF NOT EXISTS dpco_notification_outbox (
  id uuid PRIMARY KEY,
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  rule_id varchar(128) NOT NULL,
  entity_id varchar(255) NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(32) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 12,
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  provider_delivery_id varchar(255),
  provider_status varchar(64),
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT dpco_notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
  CONSTRAINT dpco_notification_outbox_attempts_check
    CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT dpco_notification_outbox_unique_idempotency
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS dpco_notification_outbox_claim_idx
  ON dpco_notification_outbox (status, next_attempt_at, lease_expires_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS dpco_notification_outbox_tenant_created_idx
  ON dpco_notification_outbox (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dpco_notification_outbox_dead_letter_idx
  ON dpco_notification_outbox (dead_lettered_at DESC)
  WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS dpco_notification_outbox_event_data_gin_idx
  ON dpco_notification_outbox USING gin (event_data jsonb_path_ops);

COMMENT ON TABLE dpco_notification_outbox IS
  'Durable DPCO notification delivery intents. PostgreSQL is authoritative for idempotency, retry state, and lease recovery.';
COMMENT ON COLUMN dpco_notification_outbox.request_hash IS
  'SHA-256 of the canonical delivery intent. A reused idempotency key with a different hash is rejected.';
COMMENT ON COLUMN dpco_notification_outbox.lease_owner IS
  'Worker UUID that atomically owns a temporary delivery lease; stale leases are reclaimable.';
