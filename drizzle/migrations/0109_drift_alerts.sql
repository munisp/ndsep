-- Migration 0109: compliance_drift_alerts (round-9 remediation)
--
-- Unified drift-alert store serving BOTH drift producers:
--   (a) workers/python/drift_detector.py — org compliance-score drift
--       (organization_id + previous/current score + severity, status lifecycle)
--   (b) ml/ model-feature drift (KS/PSI) — model_name + feature + metric +
--       statistic/threshold, wired to continuous-training triggers.
-- The worker previously INSERTed into this table with NO migration creating
-- it (silent failure on every cycle); this migration makes the schema real.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS compliance_drift_alerts (
  id                BIGSERIAL PRIMARY KEY,
  -- org-score drift (drift_detector.py)
  organization_id   INTEGER,
  drift_type        TEXT,
  previous_score    NUMERIC(6, 2),
  current_score     NUMERIC(6, 2),
  drift_percentage  NUMERIC(7, 2),
  -- model-feature drift (KS/PSI)
  model_name        TEXT,
  feature           TEXT,
  metric            TEXT CHECK (metric IS NULL OR metric IN ('ks', 'psi')),
  statistic         DOUBLE PRECISION,
  threshold         DOUBLE PRECISION,
  -- shared
  severity          TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('info', 'low', 'medium', 'high', 'warning', 'critical')),
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved', 'retraining_triggered')),
  window_start      TIMESTAMPTZ,
  window_end        TIMESTAMPTZ,
  sample_size       INTEGER,
  details           JSONB,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_compliance_drift_alerts_org
  ON compliance_drift_alerts (organization_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_drift_alerts_open
  ON compliance_drift_alerts (organization_id, status, detected_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_compliance_drift_alerts_model
  ON compliance_drift_alerts (model_name, detected_at DESC)
  WHERE model_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_drift_alerts_retrain
  ON compliance_drift_alerts (detected_at)
  WHERE status = 'open' AND severity IN ('high', 'critical', 'warning');
