-- Migration 0104: Round-9 FIX-B — surge alert dedupe (unique partial index).
--
-- Problem: surge alert dedupe was SELECT-then-INSERT (TOCTOU): two concurrent
-- detector runs could both open an alert for the same (controller_key, method).
--
-- Fix: resolve any pre-existing duplicate open alerts (keeping the OLDEST open
-- alert per pair), then replace the non-unique partial index with a UNIQUE
-- one. The detector additionally uses INSERT ... ON CONFLICT (controller_key,
-- method) WHERE status = 'open' DO NOTHING, so a lost race is absorbed by the
-- constraint instead of raising an error.
--
-- Idempotent: the UPDATE only touches still-duplicate rows; index statements
-- use IF [NOT] EXISTS.

-- 1. Resolve duplicate open alerts: keep the oldest, resolve the rest.
UPDATE surge_alerts a
SET status = 'resolved',
    resolved_at = NOW(),
    notes = COALESCE(notes, '') || ' [deduped by migration 0104: duplicate open alert]'
WHERE status = 'open'
  AND EXISTS (
    SELECT 1 FROM surge_alerts b
    WHERE b.controller_key = a.controller_key
      AND b.method = a.method
      AND b.status = 'open'
      AND b.id < a.id
  );

-- 2. Recreate the partial index as UNIQUE (drop legacy non-unique form first).
DROP INDEX IF EXISTS idx_surge_alerts_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_surge_alerts_open
  ON surge_alerts (controller_key, method)
  WHERE status = 'open';
