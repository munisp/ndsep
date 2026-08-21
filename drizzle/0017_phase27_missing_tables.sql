-- Migration: 0017_phase27_missing_tables.sql
-- Created: Phase 27 — adds tables that were created directly via psql
-- and must be tracked in the Drizzle migration history.

-- ── 1. Risk Scorecard Entries ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scorecard_entries (
  id               SERIAL PRIMARY KEY,
  org_id           INTEGER,
  risk_category    TEXT NOT NULL,
  risk_name        TEXT NOT NULL,
  likelihood       INTEGER DEFAULT 3,
  impact           INTEGER DEFAULT 3,
  risk_level       TEXT NOT NULL DEFAULT 'medium',
  mitigation_plan  TEXT,
  owner            TEXT,
  review_date      DATE,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Data Residency Locations (extended columns) ───────────────────────────
ALTER TABLE data_residency_locations
  ADD COLUMN IF NOT EXISTS data_category      TEXT,
  ADD COLUMN IF NOT EXISTS storage_country    TEXT,
  ADD COLUMN IF NOT EXISTS storage_region     TEXT,
  ADD COLUMN IF NOT EXISTS provider_name      TEXT,
  ADD COLUMN IF NOT EXISTS provider_type      TEXT,
  ADD COLUMN IF NOT EXISTS latitude           NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS longitude          NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS volume_gb          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS adequacy_decision  BOOLEAN DEFAULT FALSE;

-- Make legacy NOT NULL columns nullable so the phase13 insert (which omits them) works
ALTER TABLE data_residency_locations
  ALTER COLUMN country_code DROP NOT NULL,
  ALTER COLUMN country_name DROP NOT NULL;

-- ── 3. Bulk DSAR Jobs (extended columns) ────────────────────────────────────
ALTER TABLE bulk_dsar_jobs
  ADD COLUMN IF NOT EXISTS org_id           INTEGER,
  ADD COLUMN IF NOT EXISTS job_type         TEXT DEFAULT 'access',
  ADD COLUMN IF NOT EXISTS input_file_url   TEXT,
  ADD COLUMN IF NOT EXISTS output_file_url  TEXT,
  ADD COLUMN IF NOT EXISTS error_count      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_count  INTEGER DEFAULT 0;

-- ── 4. Regulatory Reports (extended columns) ─────────────────────────────────
ALTER TABLE regulatory_reports
  ADD COLUMN IF NOT EXISTS report_name    TEXT,
  ADD COLUMN IF NOT EXISTS org_id         INTEGER,
  ADD COLUMN IF NOT EXISTS generated_by   TEXT,
  ADD COLUMN IF NOT EXISTS data_snapshot  JSONB DEFAULT '{}';

-- ── 5. Changelogs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS changelogs (
  id           SERIAL PRIMARY KEY,
  version      TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  category     TEXT DEFAULT 'feature',
  is_published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. Compliance Score History ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_score_history (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER,
  sector      TEXT,
  score       NUMERIC(5,2) NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_score_history_recorded_at
  ON compliance_score_history (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_score_history_sector
  ON compliance_score_history (sector, recorded_at DESC);

-- ── 7. Risk score computed column ────────────────────────────────────────────
ALTER TABLE risk_scorecard_entries
  ADD COLUMN IF NOT EXISTS risk_score INTEGER GENERATED ALWAYS AS (likelihood * impact) STORED;
