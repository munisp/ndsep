-- Migration: Add is_primary and joined_at columns to organization_users
-- Phase 38/39: organization_users table was created via raw SQL without these columns

ALTER TABLE organization_users
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Index for fast lookup of primary org per user
CREATE INDEX IF NOT EXISTS idx_org_users_user_primary
  ON organization_users (user_id, is_primary)
  WHERE is_primary = true;
