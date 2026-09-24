-- Migration: Election-Period Oversight (Gap 15)
-- Proclaimed election periods with heightened-scrutiny mode, political
-- microtargeting report intake and INEC liaison referrals.
-- Idempotent: safe to re-run.

-- ─── Election periods ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS election_periods (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(256) NOT NULL,           -- e.g. "2027 General Elections"
  description           TEXT,
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ NOT NULL,
  status                VARCHAR(32) NOT NULL DEFAULT 'proclaimed', -- proclaimed|active|concluded|archived
  heightened_scrutiny   BOOLEAN NOT NULL DEFAULT false,  -- raises priority of political-data complaints + enables microtargeting intake
  proclaimed_by         INTEGER,                          -- admin user id
  proclaimed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluded_at          TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one active heightened-scrutiny period at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_election_periods_one_active
  ON election_periods ((status))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_election_periods_window
  ON election_periods (starts_at, ends_at);

-- ─── Political microtargeting reports (public intake during scrutiny mode) ──
CREATE TABLE IF NOT EXISTS political_microtargeting_reports (
  id                SERIAL PRIMARY KEY,
  election_period_id INTEGER REFERENCES election_periods(id),
  reference_number  VARCHAR(32) UNIQUE NOT NULL,         -- PMR-YYYY-#####
  reporter_name     VARCHAR(256),
  reporter_email    VARCHAR(256),
  is_anonymous      BOOLEAN NOT NULL DEFAULT false,
  party_or_campaign VARCHAR(256) NOT NULL,
  platform          VARCHAR(64) NOT NULL,                -- facebook|instagram|x|tiktok|whatsapp|sms|other
  description       TEXT NOT NULL,
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  region_state      VARCHAR(64),                          -- Nigerian state where observed
  status            VARCHAR(32) NOT NULL DEFAULT 'received', -- received|under_review|escalated|referred_to_inec|dismissed|closed
  reviewed_by       INTEGER,
  review_notes      TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS pmr_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_pmr_status
  ON political_microtargeting_reports (status)
  WHERE status IN ('received', 'under_review');
CREATE INDEX IF NOT EXISTS idx_pmr_period
  ON political_microtargeting_reports (election_period_id);

-- ─── INEC liaison referrals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inec_referrals (
  id                SERIAL PRIMARY KEY,
  case_reference    VARCHAR(64) UNIQUE NOT NULL,         -- INEC-YYYY-#####
  election_period_id INTEGER REFERENCES election_periods(id),
  microtargeting_report_id INTEGER REFERENCES political_microtargeting_reports(id),
  complaint_reference VARCHAR(64),                        -- optional link to citizen_requests.reference_number
  subject           VARCHAR(512) NOT NULL,
  summary           TEXT NOT NULL,
  status            VARCHAR(32) NOT NULL DEFAULT 'referred', -- referred|acknowledged|joint_action|resolved|closed
  joint_action_notes TEXT,
  referred_by       INTEGER,
  referred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS inec_referral_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_inec_referrals_status
  ON inec_referrals (status)
  WHERE status NOT IN ('resolved', 'closed');
