-- Migration 0137: learned_risk_weights — ML-learned supervision risk weights.
--
-- Round 12 Wave 8 (roadmap P2). ml/models/risk_weight_learner.py trains a
-- logistic model on risk_score_inputs x subsequent enforcement_notices
-- outcomes and inserts ONE row per training run with active=false.
--
-- ACTIVATION IS DELIBERATE (no admin UI): activate exactly one version via
--     UPDATE learned_risk_weights SET active = false WHERE active;
--     UPDATE learned_risk_weights SET active = true
--     WHERE version = '<version>';
-- server/services/riskWeights.getActiveWeights() honours an active row ONLY
-- when trained_at is fresh (< 30 days) and the weights vector covers all six
-- RISK_FACTOR_KEYS with non-negative finite values; otherwise it fails closed
-- to the hand-seeded DEFAULT_RISK_WEIGHTS in supervisionRiskScoring.ts.
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS learned_risk_weights (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version     text NOT NULL,
  weights     jsonb NOT NULL,            -- {factor_key: weight}, sums to 1
  trained_at  timestamptz NOT NULL,
  sample_size integer NOT NULL,
  metrics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one ACTIVE learned weight set at any time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_risk_weights_active
  ON learned_risk_weights (active) WHERE active;

CREATE INDEX IF NOT EXISTS idx_learned_risk_weights_trained_at
  ON learned_risk_weights (trained_at DESC);
