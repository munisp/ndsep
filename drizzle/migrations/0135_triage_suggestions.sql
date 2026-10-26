-- Migration 0135: triage_suggestions — pending AI auto-triage suggestions.
--
-- Round 12 Wave 7 (roadmap §6, intelligent assistance / assist-mode triage).
-- Auto-triage NEVER mutates public_complaints directly: when the local LLM
-- gateway (ollama wrapper, /classify) predicts category/severity/team with
-- confidence >= AUTO_TRIAGE_CONFIDENCE (default 0.75), the suggestion is
-- parked HERE as a PENDING row and an officer explicitly accepts / edits /
-- rejects it via autoTriage.decide (which also appends the outcome to
-- decision_feedback, migration 0127, keyed by prediction_id).
--
-- Columns: exactly the roadmap set, plus prediction_id (uuid) linking the
-- suggestion to its decision_feedback minted baseline row so the decide
-- flow can append the human outcome under the Wave-1 feedback loop.
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS triage_suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id   integer NOT NULL,
  prediction_id  uuid,
  category       text NOT NULL,
  severity       text NOT NULL,
  suggested_team text NOT NULL,
  confidence     numeric NOT NULL,
  model_version  text,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'edited', 'rejected')),
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triage_suggestions_complaint
  ON triage_suggestions (complaint_id);

CREATE INDEX IF NOT EXISTS idx_triage_suggestions_pending
  ON triage_suggestions (status, created_at)
  WHERE status = 'pending';
