-- Migration: Sector-regulator reconciliation (gap 8)
-- Dual-jurisdiction conflict records between sector regulators (CBN, NCC,
-- NDPC, NAICOM, SEC, FCCPC, ...) and MoU-based regulator-to-regulator case
-- referral workflow.

-- Conflicts where more than one regulator claims or shares jurisdiction over
-- the same matter. `precedence_decision` records which regulator leads after
-- reconciliation and why.
CREATE TABLE IF NOT EXISTS jurisdiction_conflicts (
  id SERIAL PRIMARY KEY,
  matter_ref VARCHAR(100) NOT NULL,
  regulators JSONB NOT NULL DEFAULT '[]',
  conflict_type VARCHAR(50) NOT NULL DEFAULT 'overlapping_mandate',
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'raised'
    CHECK (status IN ('raised', 'under_review', 'resolved', 'escalated')),
  precedence_decision TEXT,
  lead_regulator VARCHAR(50),
  decided_by VARCHAR(255),
  raised_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_conflicts_matter
  ON jurisdiction_conflicts (matter_ref);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_conflicts_status
  ON jurisdiction_conflicts (status)
  WHERE status NOT IN ('resolved');

-- MoU-based regulator-to-regulator case referrals.
-- Lifecycle: sent -> acknowledged -> accepted | declined -> resolved.
CREATE TABLE IF NOT EXISTS case_referrals (
  id SERIAL PRIMARY KEY,
  referral_ref VARCHAR(50) NOT NULL UNIQUE,
  from_regulator VARCHAR(50) NOT NULL,
  to_regulator VARCHAR(50) NOT NULL,
  matter_ref VARCHAR(100),
  case_payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'acknowledged', 'accepted', 'declined', 'resolved')),
  notes TEXT,
  responded_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_case_referrals_to
  ON case_referrals (to_regulator, status);

CREATE INDEX IF NOT EXISTS idx_case_referrals_from
  ON case_referrals (from_regulator, status);
