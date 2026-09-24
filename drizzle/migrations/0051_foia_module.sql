-- Migration: FOIA Module (Gap 14)
-- Freedom of Information Act 2011 request intake, statutory 7-day deadline
-- tracking, exemption-coded refusals and the NDPC officer task queue.
-- Idempotent: safe to re-run.

-- ─── Exemption codes (FOIA 2011 ss. 11, 12, 14, 15) ─────────────────────────
DO $$ BEGIN
  CREATE TYPE foia_exemption_code AS ENUM ('national_security', 'personal_privacy', 'law_enforcement', 'commercial_confidence');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── FOIA requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS foia_requests (
  id                SERIAL PRIMARY KEY,
  reference_number  VARCHAR(32) UNIQUE NOT NULL,         -- FOIA-YYYY-#####
  requester_name    VARCHAR(256) NOT NULL,
  requester_email   VARCHAR(256) NOT NULL,
  requester_phone   VARCHAR(64),
  subject           VARCHAR(512) NOT NULL,
  description       TEXT NOT NULL,
  preferred_format  VARCHAR(32) NOT NULL DEFAULT 'electronic', -- electronic|paper|inspect
  status            VARCHAR(32) NOT NULL DEFAULT 'received',
    -- received -> processing -> partial_disclosure|disclosed|refused -> closed
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  statutory_deadline TIMESTAMPTZ NOT NULL,               -- received_at + 7 days (FOIA 2011 s.4)
  assigned_officer_id INTEGER,
  exemption_code    foia_exemption_code,                 -- set when status = 'refused'
  refusal_reason    TEXT,
  disclosure_notes  TEXT,
  disclosed_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foia_requests_status
  ON foia_requests (status)
  WHERE status IN ('received', 'processing');
CREATE INDEX IF NOT EXISTS idx_foia_requests_deadline
  ON foia_requests (statutory_deadline)
  WHERE status IN ('received', 'processing');
CREATE INDEX IF NOT EXISTS idx_foia_requests_ref
  ON foia_requests (reference_number);

-- ─── Reference-number sequence (per-year FOIA-YYYY-#####) ───────────────────
CREATE SEQUENCE IF NOT EXISTS foia_requests_ref_seq START 1;

-- ─── Internal task queue for NDPC officers ──────────────────────────────────
CREATE TABLE IF NOT EXISTS foia_tasks (
  id           SERIAL PRIMARY KEY,
  foia_request_id INTEGER NOT NULL REFERENCES foia_requests(id),
  task_type    VARCHAR(32) NOT NULL,          -- triage|retrieve_records|redact|review_exemption|release
  title        VARCHAR(512) NOT NULL,
  notes        TEXT,
  status       VARCHAR(32) NOT NULL DEFAULT 'open', -- open|in_progress|done|cancelled
  assigned_to  INTEGER,
  due_at       TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foia_tasks_request
  ON foia_tasks (foia_request_id);
CREATE INDEX IF NOT EXISTS idx_foia_tasks_status
  ON foia_tasks (status)
  WHERE status IN ('open', 'in_progress');
