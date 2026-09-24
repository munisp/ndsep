-- Migration: Offline field inspection sync
-- Inspection cases with offline-queued evidence, idempotent upsert by
-- client-generated UUID, and a conflict log for last-write-wins resolution.

CREATE TABLE IF NOT EXISTS inspection_cases (
  id SERIAL PRIMARY KEY,
  case_uuid UUID NOT NULL UNIQUE,
  organization_id INTEGER,
  inspector_id VARCHAR(128),
  title VARCHAR(256) NOT NULL,
  scope TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_field', 'synced', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_cases_org
  ON inspection_cases (organization_id);
CREATE INDEX IF NOT EXISTS idx_inspection_cases_status
  ON inspection_cases (status);

CREATE TABLE IF NOT EXISTS inspection_evidence (
  id SERIAL PRIMARY KEY,
  evidence_uuid UUID NOT NULL UNIQUE,
  case_uuid UUID NOT NULL REFERENCES inspection_cases(case_uuid),
  client_device_id VARCHAR(128),
  evidence_type VARCHAR(32) NOT NULL DEFAULT 'observation'
    CHECK (evidence_type IN ('photo', 'document', 'interview_note', 'observation', 'screenshot')),
  payload JSONB,
  captured_at TIMESTAMPTZ,
  client_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version_vector JSONB,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_evidence_case
  ON inspection_evidence (case_uuid);

CREATE TABLE IF NOT EXISTS inspection_sync_conflicts (
  id SERIAL PRIMARY KEY,
  evidence_uuid UUID NOT NULL,
  case_uuid UUID,
  client_device_id VARCHAR(128),
  conflict_field VARCHAR(128),
  client_value JSONB,
  server_value JSONB,
  resolution VARCHAR(32) NOT NULL
    CHECK (resolution IN ('server_wins', 'client_wins')),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_conflicts_evidence
  ON inspection_sync_conflicts (evidence_uuid);
