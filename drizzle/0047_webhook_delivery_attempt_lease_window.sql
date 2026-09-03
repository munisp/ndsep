-- A processing queue record must carry a future lease relative to its claim time.
-- NOT VALID enforces the invariant for new writes immediately; validation confirms
-- the existing migration-owned queue is consistent without mutating application data.
ALTER TABLE webhook_delivery_attempts
  ADD CONSTRAINT webhook_delivery_attempt_processing_lease_window_check
  CHECK (
    status <> 'processing'
    OR claim_expires_at > claimed_at
  ) NOT VALID;

ALTER TABLE webhook_delivery_attempts
  VALIDATE CONSTRAINT webhook_delivery_attempt_processing_lease_window_check;
