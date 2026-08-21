-- ============================================================
-- Migration: 0018_phase29_30_fixes.sql
-- Purpose: create phase-13 runtime tables that are not owned by
-- drizzle/schema.ts. ORM-owned KYC, AML, DPO, and data-residency
-- changes are applied after their canonical tables exist.
-- ============================================================

-- ── Penalty calculations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS penalty_calculations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  violation_type VARCHAR(100),
  base_penalty NUMERIC(20,2),
  final_penalty NUMERIC(20,2),
  aggravating_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  mitigating_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  calculated_by VARCHAR(255),
  approved_by VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cross-border transfers ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cross_border_transfers (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  org_name VARCHAR(255),
  transfer_ref VARCHAR(100) UNIQUE,
  destination_country VARCHAR(100) NOT NULL,
  data_category TEXT,
  data_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  transfer_mechanism VARCHAR(100),
  volume_records BIGINT,
  legal_basis VARCHAR(100),
  adequacy_decision BOOLEAN NOT NULL DEFAULT FALSE,
  safeguards TEXT,
  risk_level VARCHAR(50) NOT NULL DEFAULT 'medium',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  nitda_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_penalty_calculations_org ON penalty_calculations(organization_id);
CREATE INDEX IF NOT EXISTS idx_penalty_calculations_status ON penalty_calculations(status);
CREATE INDEX IF NOT EXISTS idx_cross_border_transfers_org ON cross_border_transfers(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_border_transfers_status ON cross_border_transfers(status, risk_level);
