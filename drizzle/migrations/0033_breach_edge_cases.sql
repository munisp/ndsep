-- Migration: Breach notification edge cases (NDPA 2023 s.40)
-- Schema extension for joint controllers, processor-originated and
-- cross-border breaches, ransomware exfiltration flag; late-notification
-- auto-penalty drafts; incomplete-notification supplementation flow.

ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS joint_controller_ids JSONB;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS processor_origin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS originating_processor_id INTEGER;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS is_cross_border BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS affected_jurisdictions JSONB;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS ransomware_data_exfiltrated BOOLEAN;
ALTER TABLE breach_incidents
  ADD COLUMN IF NOT EXISTS notification_completed_at TIMESTAMPTZ;

-- Auto-generated penalty drafts when NDPC notification exceeds 72 hours
CREATE TABLE IF NOT EXISTS breach_late_penalties (
  id SERIAL PRIMARY KEY,
  breach_id INTEGER NOT NULL REFERENCES breach_incidents(id),
  organization_id INTEGER NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL,
  hours_late NUMERIC(10, 2) NOT NULL,
  proposed_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'waived', 'cancelled')),
  admin_task_created BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  reviewed_by VARCHAR(256),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_breach_late_penalties_breach
  ON breach_late_penalties (breach_id);
CREATE INDEX IF NOT EXISTS idx_breach_late_penalties_status
  ON breach_late_penalties (status);

-- Supplements to incomplete breach notifications
CREATE TABLE IF NOT EXISTS breach_supplements (
  id SERIAL PRIMARY KEY,
  breach_id INTEGER NOT NULL REFERENCES breach_incidents(id),
  supplement_sequence INTEGER NOT NULL DEFAULT 1,
  supplementary_details TEXT NOT NULL,
  reason TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected')),
  submitted_by VARCHAR(256),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by VARCHAR(256),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT breach_supplements_unique_seq UNIQUE (breach_id, supplement_sequence)
);

CREATE INDEX IF NOT EXISTS idx_breach_supplements_breach
  ON breach_supplements (breach_id);
