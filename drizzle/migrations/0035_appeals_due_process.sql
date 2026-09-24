-- Migration: Appeals due process
-- Hearing scheduling, 30-day appeal deadline tracking, automatic stay of
-- enforcement via companion table, tribunal escalation tracking.

-- Deadline column on existing appeals (30 days from the penalty decision date)
ALTER TABLE penalty_appeals
  ADD COLUMN IF NOT EXISTS appeal_deadline TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS appeal_hearings (
  id SERIAL PRIMARY KEY,
  appeal_id INTEGER NOT NULL REFERENCES penalty_appeals(id),
  hearing_date TIMESTAMPTZ NOT NULL,
  location VARCHAR(256),
  mode VARCHAR(16) NOT NULL DEFAULT 'in_person'
    CHECK (mode IN ('in_person', 'virtual', 'hybrid')),
  panel JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'held', 'adjourned', 'cancelled')),
  outcome TEXT,
  minutes_url TEXT,
  created_by VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appeal_hearings_appeal
  ON appeal_hearings (appeal_id);

-- Companion table for automatic stay of enforcement while an appeal is pending.
-- (The financial_penalties payment_status enum is intentionally untouched.)
CREATE TABLE IF NOT EXISTS penalty_stays (
  id SERIAL PRIMARY KEY,
  penalty_id INTEGER NOT NULL REFERENCES financial_penalties(id),
  appeal_id INTEGER REFERENCES penalty_appeals(id),
  stay_reason VARCHAR(128) NOT NULL DEFAULT 'appeal_filed',
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'lifted', 'expired')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at TIMESTAMPTZ,
  lifted_by VARCHAR(256),
  lift_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one active stay per penalty
CREATE UNIQUE INDEX IF NOT EXISTS idx_penalty_stays_active
  ON penalty_stays (penalty_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS tribunal_escalations (
  id SERIAL PRIMARY KEY,
  appeal_id INTEGER NOT NULL REFERENCES penalty_appeals(id),
  penalty_id INTEGER REFERENCES financial_penalties(id),
  tribunal_name VARCHAR(256) NOT NULL DEFAULT 'Data Protection Tribunal',
  case_number VARCHAR(128),
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(32) NOT NULL DEFAULT 'filed'
    CHECK (status IN ('filed', 'heard', 'decided', 'withdrawn')),
  decision TEXT,
  decided_at TIMESTAMPTZ,
  created_by VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tribunal_escalations_appeal
  ON tribunal_escalations (appeal_id);
