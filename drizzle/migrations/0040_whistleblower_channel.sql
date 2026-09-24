-- Migration: Whistleblower follow-up secure channel (gap 7)
-- Pseudonymous two-way channel on top of whistleblower_reports: one-time
-- access tokens (SHA-256 hashed at rest), encrypted message log, employer
-- retaliation protection flags, and reward/recognition tracking.

-- One-time access tokens issued to reporters at submission. Only the SHA-256
-- hash is persisted; the raw token is displayed to the reporter exactly once.
CREATE TABLE IF NOT EXISTS whistleblower_channel_tokens (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES whistleblower_reports(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  issued_to VARCHAR(20) NOT NULL DEFAULT 'reporter',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wb_channel_tokens_report
  ON whistleblower_channel_tokens (report_id);

CREATE INDEX IF NOT EXISTS idx_wb_channel_tokens_active
  ON whistleblower_channel_tokens (token_hash)
  WHERE revoked_at IS NULL;

-- Two-way message log between the pseudonymous reporter and the case officer.
-- `encrypted` marks rows whose `body` was encrypted at rest by the platform
-- encryption middleware; the flag is stored so reads know to decrypt.
CREATE TABLE IF NOT EXISTS whistleblower_messages (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES whistleblower_reports(id) ON DELETE CASCADE,
  sender VARCHAR(20) NOT NULL CHECK (sender IN ('reporter', 'case_officer')),
  body TEXT NOT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT true,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wb_messages_report
  ON whistleblower_messages (report_id, created_at);

-- Retaliation-protection workflow: reporter reports employer retaliation and
-- NDPC tracks protective measures through a status lifecycle.
CREATE TABLE IF NOT EXISTS protection_flags (
  id SERIAL PRIMARY KEY,
  report_id INTEGER REFERENCES whistleblower_reports(id) ON DELETE SET NULL,
  reporter_email VARCHAR(255),
  employer_name VARCHAR(255),
  retaliation_type VARCHAR(50) NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'protective_measures', 'closed')),
  protective_measures TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'high',
  assigned_to VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_protection_flags_status
  ON protection_flags (status)
  WHERE status <> 'closed';

-- Reward / recognition tracking for substantiated whistleblower reports.
CREATE TABLE IF NOT EXISTS whistleblower_rewards (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES whistleblower_reports(id) ON DELETE CASCADE,
  reward_type VARCHAR(30) NOT NULL DEFAULT 'recognition'
    CHECK (reward_type IN ('recognition', 'monetary', 'commendation')),
  amount NUMERIC(14, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  citation TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'nominated'
    CHECK (status IN ('nominated', 'approved', 'paid', 'declined')),
  decided_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wb_rewards_report
  ON whistleblower_rewards (report_id);
