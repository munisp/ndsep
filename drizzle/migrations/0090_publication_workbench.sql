-- Migration: Enforcement decision publication workbench (NDPA 2023 ss.48-49)
-- Publication pipeline: draft -> legal_review -> redaction -> approval (dual control)
-- -> published -> corrected/withdrawn. Redaction map stored separately from redacted
-- text; disclosure access log for FOIA accountability on public reads.
-- Idempotent: safe to re-run. Complements 0050_public_sanctions_register.sql
-- (publication_documents mirrors enforcement_notices display conventions without
-- editing that table).

-- ─── Publication documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publication_documents (
  id                SERIAL PRIMARY KEY,
  case_id           INTEGER,                          -- originating enforcement/investigation case
  organization_id   INTEGER REFERENCES organizations(id),
  org_name          VARCHAR(256),                     -- denormalised for public display (mirrors enforcement_notices)
  doc_type          VARCHAR(32) NOT NULL
    CHECK (doc_type IN ('final_order', 'undertaking', 'administrative_fine', 'reprimand', 'decision', 'guidance', 'other')),
  title             VARCHAR(512) NOT NULL,
  summary           TEXT,
  body_raw          TEXT,                             -- unredacted source (encrypted at rest by app layer)
  body_redacted     TEXT,                             -- public-safe text produced by the redaction engine
  redaction_complete BOOLEAN NOT NULL DEFAULT FALSE,
  investigation_sensitive BOOLEAN NOT NULL DEFAULT FALSE,  -- flagged: contains investigation-sensitive material
  legal_instrument_ref VARCHAR(128),                  -- e.g. "NDPA 2023 s.48(2)"
  gazette_number    VARCHAR(64),
  status            VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'legal_review', 'redaction', 'approval', 'published', 'corrected', 'withdrawn')),
  public_note       TEXT,                             -- correction / withdrawal notice shown publicly
  published_at      TIMESTAMPTZ,
  corrected_at      TIMESTAMPTZ,
  withdrawn_at      TIMESTAMPTZ,
  created_by        VARCHAR(256),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publication_documents_status
  ON publication_documents (status);
CREATE INDEX IF NOT EXISTS idx_publication_documents_published
  ON publication_documents (published_at DESC)
  WHERE status IN ('published', 'corrected');
CREATE INDEX IF NOT EXISTS idx_publication_documents_org
  ON publication_documents (organization_id);
CREATE INDEX IF NOT EXISTS idx_publication_documents_case
  ON publication_documents (case_id);

-- ─── Redaction tasks (redaction map kept SEPARATE from redacted text) ───────
-- redaction_map contains original->token mappings: ADMIN-ONLY access enforced
-- at the router layer; never returned on public endpoints.
CREATE TABLE IF NOT EXISTS redaction_tasks (
  id                 SERIAL PRIMARY KEY,
  document_id        INTEGER NOT NULL REFERENCES publication_documents(id),
  redaction_map      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{token, type, original}] — restricted
  rules_applied      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- rule identifiers that fired
  minor_names_applied JSONB NOT NULL DEFAULT '[]'::jsonb, -- minor-protection substitutions made
  status             VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'signed_off', 'rejected')),
  reviewer_id        VARCHAR(256),                    -- reviewer sign-off identity
  reviewer_note      TEXT,
  signed_off_at      TIMESTAMPTZ,
  created_by         VARCHAR(256),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redaction_tasks_doc
  ON redaction_tasks (document_id);
CREATE INDEX IF NOT EXISTS idx_redaction_tasks_status
  ON redaction_tasks (status)
  WHERE status = 'pending';

-- ─── Publication approvals (dual control: two DISTINCT approvers) ───────────
CREATE TABLE IF NOT EXISTS publication_approvals (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES publication_documents(id),
  stage         VARCHAR(24) NOT NULL DEFAULT 'publication'
    CHECK (stage IN ('legal_review', 'publication')),
  approver_id   VARCHAR(256) NOT NULL,
  approver_name VARCHAR(256),
  decision      VARCHAR(16) NOT NULL
    CHECK (decision IN ('approved', 'rejected')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, stage, approver_id)            -- one decision per approver per stage
);

CREATE INDEX IF NOT EXISTS idx_publication_approvals_doc
  ON publication_approvals (document_id);

-- ─── Disclosure access log (FOIA accountability for public reads) ───────────
CREATE TABLE IF NOT EXISTS disclosure_access_log (
  id            BIGSERIAL PRIMARY KEY,
  document_id   INTEGER REFERENCES publication_documents(id),  -- NULL for register-list accesses
  accessor_type VARCHAR(16) NOT NULL DEFAULT 'anonymous'
    CHECK (accessor_type IN ('anonymous', 'authenticated', 'admin')),
  accessor_id   VARCHAR(256),                         -- user id when authenticated, else NULL
  accessor_ref  VARCHAR(256),                         -- hashed/short ref (e.g. session or request ref), never raw PII
  endpoint      VARCHAR(64) NOT NULL,                 -- list | detail
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disclosure_access_log_doc
  ON disclosure_access_log (document_id);
CREATE INDEX IF NOT EXISTS idx_disclosure_access_log_time
  ON disclosure_access_log (accessed_at DESC);
