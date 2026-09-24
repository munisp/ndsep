-- Migration: Add is_active column to users
-- userManagement.deactivate (production9Features) wrote is_active=false but the
-- column did not exist, so offboarding failed at runtime.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Index for fast filtering of active vs deactivated accounts
CREATE INDEX IF NOT EXISTS idx_users_is_active
  ON users (is_active)
  WHERE is_active = false;
