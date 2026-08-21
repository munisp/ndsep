-- Migration: Add missing columns to citizen_requests table
-- Fixes: DSAR publicSubmit mutation references columns that don't exist
-- Date: 2026-05-01

ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(32) UNIQUE,
  ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMP,
  ADD COLUMN IF NOT EXISTS supporting_doc_url TEXT,
  ADD COLUMN IF NOT EXISTS supporting_doc_key TEXT;

-- Index for DSAR tracking lookups (reference_number + citizen_email)
CREATE INDEX IF NOT EXISTS idx_citizen_requests_reference
  ON citizen_requests (reference_number)
  WHERE reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citizen_requests_tracking
  ON citizen_requests (reference_number, citizen_email)
  WHERE reference_number IS NOT NULL;

-- Index for deadline monitoring
CREATE INDEX IF NOT EXISTS idx_citizen_requests_deadline
  ON citizen_requests (response_deadline, status)
  WHERE status NOT IN ('completed', 'rejected');
