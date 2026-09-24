-- Migration: DSAR status vocabulary + workflow columns (citizen_requests)
-- ============================================================================
-- Idempotent: every statement is safe to re-run (IF NOT EXISTS / DO blocks).
--
-- Audit fixes covered:
--   F-08/F-09 — canonical DSAR status vocabulary
--     (submitted/acknowledged/in_progress/completed/rejected/escalated) plus
--     an explicit 'overdue' marker value; escalation metadata columns used by
--     enhancements.ts dsarRouter.escalate.
--   F-14 — assignment/extension columns used by phase11Features.ts
--     dsarAutomationRouter (autoAssign / bulkExtend), repointed from the
--     legacy dsar_requests table onto citizen_requests.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- PostgreSQL < 12 semantics; apply with `psql -f` or a per-statement runner,
-- consistent with the other plain scripts in this folder.
-- ============================================================================

-- ─── 1. Enum: add 'overdue' to citizen_request_status ────────────────────────
-- The canonical lifecycle is submitted → acknowledged → in_progress →
-- completed/rejected, with escalated as an open side-state. 'overdue' records
-- a deadline breach as a first-class status.
-- ADD VALUE IF NOT EXISTS is natively idempotent; do not run this file inside
-- an explicit transaction block (same constraint as CREATE INDEX CONCURRENTLY).
ALTER TYPE citizen_request_status ADD VALUE IF NOT EXISTS 'overdue';

-- ─── 2. Escalation metadata (enhancements.ts dsarRouter.escalate) ────────────
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT;

-- ─── 3. Assignment + deadline-extension metadata (phase11 dsarAutomation) ────
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT,
  ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ;

-- ─── 4. Supporting indexes ───────────────────────────────────────────────────
-- Staff queue filtering by status + deadline (listWithDeadlines / alerts).
CREATE INDEX IF NOT EXISTS idx_citizen_requests_status_deadline
  ON citizen_requests (status, response_deadline);

CREATE INDEX IF NOT EXISTS idx_citizen_requests_assigned_to
  ON citizen_requests (assigned_to)
  WHERE assigned_to IS NOT NULL;
