-- Migration 0133: label_runs — audit trail for ML label production.
--
-- Round 12 Wave 5 (roadmap §4.2/§4.5). Every run of an outcome-label
-- builder (ml/labels/case_outcome_labels.py: triage / settlement /
-- penalty_survival) appends one row here: which labeler ran, how many rows
-- it produced, and the high-water mark it advanced to — so label production
-- is auditable alongside the models trained on those labels.
--
-- Writes are best-effort from the Python labelers (a missing table never
-- blocks label production). Idempotent: IF NOT EXISTS. PostgreSQL only.

CREATE TABLE IF NOT EXISTS label_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labeler       text NOT NULL,               -- 'triage' | 'settlement' | 'penalty_survival' | ...
  rows_produced integer NOT NULL DEFAULT 0,
  watermark     text,                        -- lakehouse high-water mark after the run
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_runs_labeler
  ON label_runs (labeler, started_at DESC);
