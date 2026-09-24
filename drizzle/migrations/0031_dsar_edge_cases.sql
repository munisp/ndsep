-- Migration: DSAR edge cases (NDPA 2023)
-- On-behalf/guardian third-party submissions, deceased data subjects,
-- refusal/exemption workflow, duplicate-request merging, third-party redaction.

-- Companion columns on the existing citizen_requests table (additive only)
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS is_third_party BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS merged_into_request_id INTEGER;
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS redaction_status VARCHAR(32) NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS dsar_third_party_submissions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  representative_name VARCHAR(256) NOT NULL,
  representative_email VARCHAR(320) NOT NULL,
  representative_phone VARCHAR(32),
  relationship VARCHAR(32) NOT NULL
    CHECK (relationship IN ('guardian', 'legal_counsel', 'next_of_kin', 'authorised_agent', 'executor')),
  authority_evidence_doc_url TEXT,
  authority_evidence_doc_key TEXT,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_by VARCHAR(256),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_third_party_request
  ON dsar_third_party_submissions (request_id);

CREATE TABLE IF NOT EXISTS dsar_deceased_subjects (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  deceased_name VARCHAR(256) NOT NULL,
  death_certificate_ref VARCHAR(128) NOT NULL,
  executor_name VARCHAR(256) NOT NULL,
  executor_contact VARCHAR(320),
  executor_verification_status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (executor_verification_status IN ('pending', 'verified', 'rejected')),
  verified_by VARCHAR(256),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_deceased_request
  ON dsar_deceased_subjects (request_id);

CREATE TABLE IF NOT EXISTS dsar_refusals (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  refusal_ground VARCHAR(48) NOT NULL
    CHECK (refusal_ground IN ('manifestly_unfounded', 'manifestly_excessive', 'exemption_applies')),
  written_justification TEXT NOT NULL,
  exemption_basis VARCHAR(256),
  fee_charged NUMERIC(14, 2),
  status VARCHAR(32) NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft', 'issued', 'overturned_on_appeal')),
  appeal_pointer TEXT,
  refused_by VARCHAR(256),
  refused_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_refusals_request
  ON dsar_refusals (request_id);

-- Duplicate / competing request linking and merging
CREATE TABLE IF NOT EXISTS dsar_request_links (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  related_request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  link_type VARCHAR(32) NOT NULL
    CHECK (link_type IN ('duplicate', 'competing', 'related')),
  resolution VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (resolution IN ('pending', 'merged', 'kept_separate')),
  resolved_by VARCHAR(256),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dsar_request_links_no_self CHECK (request_id <> related_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dsar_request_links_pair
  ON dsar_request_links (LEAST(request_id, related_request_id), GREATEST(request_id, related_request_id));

-- Redaction workflow protecting third-party rights in disclosure bundles
CREATE TABLE IF NOT EXISTS dsar_redactions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES citizen_requests(id),
  document_ref TEXT NOT NULL,
  redaction_reason VARCHAR(64) NOT NULL
    CHECK (redaction_reason IN ('third_party_rights', 'legal_privilege', 'crime_prevention', 'management_forecast')),
  redacted_passages JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'applied')),
  proposed_by VARCHAR(256),
  reviewed_by VARCHAR(256),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_redactions_request
  ON dsar_redactions (request_id);
