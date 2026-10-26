-- Migration 0138: penalty_calibration_audit — advisory calibration log.
--
-- Round 12 Wave 8 (roadmap P2). Every time the penalty-calibration badge
-- (server/services/penaltyCalibration.ts) is computed alongside an NDPA
-- s.48 penalty preview, one row is appended here so the Commission can
-- later evidence WHAT the advisory model said vs WHAT the authoritative
-- s.48 engine computed.
--
-- HARD RULE (mirrors the service): this table is AUDIT-ONLY. The s.48
-- computation (penaltyEngine) is authoritative; calibration NEVER alters
-- computed amounts. computed_amount_ngn is stored verbatim for comparison.
--
-- PRIVACY: org_id is stored pseudonymized (org_hash, keyed-HMAC pattern,
-- migrations 0105/0122/0126) — never a raw org reference.
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS penalty_calibration_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id      uuid NOT NULL,      -- decision_feedback.prediction_id
  model_version      text,               -- penalty_calibration artifact version
  penalty_band       text NOT NULL,
  violation_type     text NOT NULL DEFAULT 'unknown',
  org_size           text NOT NULL DEFAULT 'unknown',
  legal_basis_section text NOT NULL DEFAULT 'unknown',
  org_hash           text,               -- pseudonymized org reference
  uphold_probability numeric CHECK (uphold_probability IS NULL
                                    OR (uphold_probability >= 0
                                        AND uphold_probability <= 1)),
  similar_median_ngn numeric,            -- median band midpoint of similar
                                         -- decided enforcement precedents
  computed_amount_ngn numeric NOT NULL,  -- authoritative s.48 amount (verbatim)
  degraded           boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_penalty_calibration_audit_prediction
  ON penalty_calibration_audit (prediction_id);

CREATE INDEX IF NOT EXISTS idx_penalty_calibration_audit_created
  ON penalty_calibration_audit (created_at DESC);
