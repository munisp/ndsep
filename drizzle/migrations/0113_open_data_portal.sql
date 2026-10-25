-- Migration: Open data portal & public API (FEAT-E, round 9)
-- Public-facing aggregate datasets (sanctions register, complaint statistics,
-- DCPMI registry counts, enforcement outcomes) with dataset versioning,
-- changelog and hashed-accessor logging. No row-level personal data is ever
-- exposed; complaint statistics enforce a k-anonymity threshold (k >= 5) in
-- the router layer. Idempotent: safe to re-run.

-- ─── Dataset registry (versioning + changelog) ──────────────────────────────
CREATE TABLE IF NOT EXISTS open_data_datasets (
  id           SERIAL PRIMARY KEY,
  dataset_key  VARCHAR(64) NOT NULL UNIQUE,   -- sanctions_register|complaint_stats|dcpmi_registry|enforcement_outcomes
  title        VARCHAR(256) NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  changelog    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{version, changed_at, changed_by, note}]
  published    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by   VARCHAR(256),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO open_data_datasets (dataset_key, title, description, updated_by)
VALUES
  ('sanctions_register',
   'Public sanctions register',
   'Published enforcement notices and publication documents (final orders, undertakings, administrative fines, reprimands). Published entries only.',
   'system-seed'),
  ('complaint_stats',
   'Complaint statistics (aggregated)',
   'Complaint counts by category, state and month. Aggregates only; cells with fewer than 5 complaints are suppressed (k-anonymity).',
   'system-seed'),
  ('dcpmi_registry',
   'DCPMI registry counts',
   'Counts of registered data controllers/processors of major importance by sector and audit-status grouping. Aggregates only.',
   'system-seed'),
  ('enforcement_outcomes',
   'Enforcement outcome statistics',
   'Enforcement case outcomes, fines imposed/collected and settlement performance by year. Aggregates only.',
   'system-seed')
ON CONFLICT (dataset_key) DO NOTHING;

-- ─── Access log (hashed accessor; raw IP / identity never stored) ───────────
CREATE TABLE IF NOT EXISTS open_data_access_log (
  id            BIGSERIAL PRIMARY KEY,
  dataset_key   VARCHAR(64) NOT NULL,
  endpoint      VARCHAR(64) NOT NULL,          -- list|export_csv|export_json|meta
  format        VARCHAR(8),                    -- json|csv
  accessor_type VARCHAR(16) NOT NULL DEFAULT 'anonymous'
    CHECK (accessor_type IN ('anonymous', 'authenticated', 'admin')),
  accessor_hash VARCHAR(64),                   -- sha256(salt + ip or user id); never raw PII
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_data_access_log_dataset
  ON open_data_access_log (dataset_key, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_data_access_log_accessor
  ON open_data_access_log (accessor_hash, accessed_at DESC);
