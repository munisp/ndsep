-- Migration 0082: Complaint surge analytics ("spikes and trends", CFPB
-- Consumer Complaint Database pattern) — tables backing
-- server/services/complaintSurge.ts and server/routers/complaintAnalytics.ts.
--
--   complaint_daily_counts  materialized daily complaint counts per
--                           controller key ("org:<id>" for registered
--                           controllers, "name:<normalized>" for free-text),
--                           rebuilt incrementally from public_complaints.
--   surge_baselines         trailing 90-day rolling baseline (mean/stddev)
--                           per controller key used for z-score detection.
--   surge_alerts            surge alerts raised by the two detectors:
--                           z-score vs 90-day baseline AND Poisson
--                           change-point (port of ml/bayesian/models.py
--                           poisson_changepoint). Thresholds are runtime
--                           configurable via env (see complaintSurge.ts).
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS complaint_daily_counts (
  id              BIGSERIAL PRIMARY KEY,
  count_date      DATE NOT NULL,
  controller_key  TEXT NOT NULL,             -- org:<id> | name:<lower-normalized>
  complaint_count INTEGER NOT NULL DEFAULT 0 CHECK (complaint_count >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_date, controller_key)
);

CREATE INDEX IF NOT EXISTS idx_complaint_daily_counts_key
  ON complaint_daily_counts (controller_key, count_date ASC);
CREATE INDEX IF NOT EXISTS idx_complaint_daily_counts_date
  ON complaint_daily_counts (count_date DESC);

CREATE TABLE IF NOT EXISTS surge_baselines (
  controller_key TEXT PRIMARY KEY,
  window_days    INTEGER NOT NULL,           -- baseline window used (default 90)
  mean_count     DOUBLE PRECISION NOT NULL,
  stddev_count   DOUBLE PRECISION NOT NULL,
  sample_days    INTEGER NOT NULL,           -- days with data in window
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surge_alerts (
  id                  BIGSERIAL PRIMARY KEY,
  controller_key      TEXT NOT NULL,
  controller_id       INTEGER REFERENCES organizations(id),
  controller_name     TEXT,
  alert_date          DATE NOT NULL,         -- day the surge was detected for
  method              TEXT NOT NULL
                      CHECK (method IN ('zscore', 'changepoint', 'combined')),
  observed_count      INTEGER NOT NULL,
  baseline_mean       DOUBLE PRECISION,
  zscore              DOUBLE PRECISION,
  -- Change-point evidence: {map_tau, mean_tau, p_lam2_gt_lam1, lam1, lam2, window_days}
  changepoint         JSONB,
  severity            TEXT NOT NULL DEFAULT 'elevated'
                      CHECK (severity IN ('elevated', 'high', 'critical')),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by     TEXT,
  acknowledged_at     TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surge_alerts_status
  ON surge_alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surge_alerts_controller
  ON surge_alerts (controller_key, alert_date DESC);
CREATE INDEX IF NOT EXISTS idx_surge_alerts_date
  ON surge_alerts (alert_date DESC);
-- One open alert per controller+method: detection re-runs skip controllers
-- that already have an open alert for the same method (app-level check on
-- this partial index).
CREATE INDEX IF NOT EXISTS idx_surge_alerts_open
  ON surge_alerts (controller_key, method) WHERE status = 'open';
