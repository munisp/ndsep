-- Migration: Minors — age assurance and consent refresh at majority (NDPA 2023)
-- Age-assurance records and the re-consent workflow that fires when a child
-- data subject turns 18.

CREATE TABLE IF NOT EXISTS age_assurance_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  data_subject_ref VARCHAR(128) NOT NULL,
  dob DATE NOT NULL,
  method VARCHAR(32) NOT NULL
    CHECK (method IN ('document', 'bank_verification', 'guardian_attestation')),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
  evidence_ref TEXT,
  guardian_name VARCHAR(256),
  guardian_contact VARCHAR(320),
  verified_by VARCHAR(256),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_age_assurance_subject
  ON age_assurance_records (data_subject_ref);
CREATE INDEX IF NOT EXISTS idx_age_assurance_org
  ON age_assurance_records (organization_id);

-- Re-consent tasks generated as a child approaches the age of majority (18)
CREATE TABLE IF NOT EXISTS consent_refresh_tasks (
  id SERIAL PRIMARY KEY,
  age_assurance_id INTEGER NOT NULL REFERENCES age_assurance_records(id),
  organization_id INTEGER NOT NULL,
  data_subject_ref VARCHAR(128) NOT NULL,
  majority_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'due', 'renewed', 'expired', 'blocked')),
  processing_blocked BOOLEAN NOT NULL DEFAULT false,
  due_at TIMESTAMPTZ,
  renewed_at TIMESTAMPTZ,
  renewed_by VARCHAR(256),
  reminder_sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_refresh_unique_assurance
  ON consent_refresh_tasks (age_assurance_id);
CREATE INDEX IF NOT EXISTS idx_consent_refresh_status
  ON consent_refresh_tasks (status, majority_date);
