-- Migration: KMS Key Metadata Table
-- Tracks encryption key versions, rotation history, and active DEK.
-- Part of the KMS envelope encryption integration (server/kms.ts).

CREATE TABLE IF NOT EXISTS encryption_key_metadata (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  key_id TEXT NOT NULL,
  encrypted_dek TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  UNIQUE(version)
);

CREATE INDEX IF NOT EXISTS idx_key_metadata_active
  ON encryption_key_metadata(is_active) WHERE is_active = true;

-- Audit trail for key operations
CREATE TABLE IF NOT EXISTS encryption_key_audit (
  id SERIAL PRIMARY KEY,
  operation TEXT NOT NULL,  -- 'generate', 'rotate', 'retire', 'access'
  key_version INTEGER NOT NULL,
  performed_by TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_key_audit_operation ON encryption_key_audit(operation);
CREATE INDEX IF NOT EXISTS idx_key_audit_timestamp ON encryption_key_audit(performed_at);
