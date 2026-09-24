-- Migration: Public Sanctions Register (Gap 13)
-- enforcement_notices powers the public register of NDPC enforcement outcomes
-- (NDPA 2023 ss. 48-49); delisting_requests drives the remediation/delisting
-- workflow. Idempotent: safe to re-run.

-- ─── Enforcement notices ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enforcement_notices (
  id                   SERIAL PRIMARY KEY,
  organization_id      INTEGER REFERENCES organizations(id),
  org_name             VARCHAR(256) NOT NULL,            -- denormalised for public display
  notice_type          VARCHAR(32) NOT NULL,             -- final_order|undertaking|administrative_fine|reprimand
  title                VARCHAR(512) NOT NULL,
  summary              TEXT,
  legal_instrument_ref VARCHAR(128),                     -- e.g. "NDPA 2023 s.48(2)"
  gazette_number       VARCHAR(64),                      -- Federal Gazette reference
  published_at         TIMESTAMPTZ,                      -- NULL until published
  sanction_start       DATE,
  sanction_end         DATE,                             -- NULL = indefinite
  status               VARCHAR(32) NOT NULL DEFAULT 'draft', -- draft|published|remediated|delisted|expired
  pdf_ref              TEXT,                             -- storage ref / URL of the signed notice PDF
  public_note          TEXT,                             -- note shown publicly (e.g. remediation outcome)
  created_by           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enforcement_notices_status
  ON enforcement_notices (status)
  WHERE status IN ('published', 'remediated');
CREATE INDEX IF NOT EXISTS idx_enforcement_notices_org
  ON enforcement_notices (organization_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_notices_type
  ON enforcement_notices (notice_type);
CREATE INDEX IF NOT EXISTS idx_enforcement_notices_published_at
  ON enforcement_notices (published_at DESC);

-- ─── Delisting requests (org applies, NDPC reviews) ────────────────────────
CREATE TABLE IF NOT EXISTS delisting_requests (
  id                SERIAL PRIMARY KEY,
  notice_id         INTEGER NOT NULL REFERENCES enforcement_notices(id),
  organization_id   INTEGER REFERENCES organizations(id),
  applicant_name    VARCHAR(256) NOT NULL,
  applicant_email   VARCHAR(256) NOT NULL,
  remediation_summary TEXT NOT NULL,                     -- what the org remediated
  evidence_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- URLs / storage keys of proof
  status            VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|under_review|approved|rejected
  reviewer_id       INTEGER,
  reviewer_notes    TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delisting_requests_notice
  ON delisting_requests (notice_id);
CREATE INDEX IF NOT EXISTS idx_delisting_requests_status
  ON delisting_requests (status)
  WHERE status = 'pending';
