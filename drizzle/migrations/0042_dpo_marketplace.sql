-- Migration: DPO marketplace (gap 11)
-- Public DPO/DPCO profiles, NDPC verification toggle, organisation engagement
-- requests, and deterministic matching support.

-- DPO / DPCO public marketplace profiles. `verified` is an NDPC-administered
-- trust flag; only admins may toggle it.
CREATE TABLE IF NOT EXISTS dpo_marketplace_profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  profile_type VARCHAR(20) NOT NULL DEFAULT 'dpo'
    CHECK (profile_type IN ('dpo', 'dpco')),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  bio TEXT,
  sectors JSONB NOT NULL DEFAULT '[]',
  regions JSONB NOT NULL DEFAULT '[]',
  languages JSONB NOT NULL DEFAULT '[]',
  capacity INTEGER NOT NULL DEFAULT 1,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_by VARCHAR(255),
  verified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpo_marketplace_active
  ON dpo_marketplace_profiles (active, verified);

-- Engagement requests posted by organisations looking for a DPO/DPCO.
-- `requirements` holds { sectors, regions, languages, min_capacity, budget }.
CREATE TABLE IF NOT EXISTS marketplace_engagements (
  id SERIAL PRIMARY KEY,
  engagement_ref VARCHAR(50) NOT NULL UNIQUE,
  org_id INTEGER,
  org_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  requirements JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'matched', 'in_progress', 'completed', 'cancelled')),
  matched_profile_id INTEGER REFERENCES dpo_marketplace_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_engagements_status
  ON marketplace_engagements (status)
  WHERE status = 'open';
