-- Migration 0127: decision_feedback — acceptance logging for AI/rule-based suggestions.
--
-- Round 12 Wave 1 (roadmap §4.1 keystone). Records every AI or rule-based
-- suggestion surfaced to a human (triage, dpiagen, form_copilot,
-- settlement_terms, risk_weights, compliance QA, ...) together with the
-- human outcome (accept / edit / reject / ignore), so acceptance rates per
-- surface can be measured and fed back into model/rule tuning.
--
-- Semantics:
--   - A suggestion is first "minted" (server inserts a baseline row with
--     action='ignore' — an unanswered suggestion is statistically an implicit
--     ignore) and its prediction_id is returned to the UI alongside the AI
--     response.
--   - When the human acts, the UI calls decisionFeedback.record which appends
--     a NEW row for the same prediction_id with the real outcome. Rows are
--     append-only; analytics take the LATEST action per prediction_id.
--   - ndsep.feedback.recorded events are emitted via the event_outbox
--     (publishWithOutbox) for downstream consumers.
--
-- PRIVACY: suggestion / final_value payloads must NEVER contain raw
-- data-subject identifiers (NIN, BVN, subject_ref, raw emails/phones of data
-- subjects). Callers pseudonymize with keyed HMAC (subject_ref_hash pattern,
-- migrations 0105/0122/0126). The server router enforces a key denylist.
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS decision_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL,
  surface       text NOT NULL,
  model_version text,
  suggestion    jsonb NOT NULL,
  actor_id      uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('accept', 'edit', 'reject', 'ignore')),
  edit_distance numeric,
  final_value   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_feedback_surface_created
  ON decision_feedback (surface, created_at);

CREATE INDEX IF NOT EXISTS idx_decision_feedback_prediction
  ON decision_feedback (prediction_id);
