-- Migration 0078: DPO marketplace profile ownership.
--
-- owner_user_id anchors authorization on updateProfile (owner or admin) and is
-- stamped from the authenticated user at createProfile time. Existing profiles
-- keep NULL owners and are admin-manageable only.
-- Idempotent: safe to run repeatedly.

ALTER TABLE dpo_marketplace_profiles
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dpo_marketplace_profiles_owner
  ON dpo_marketplace_profiles (owner_user_id);
