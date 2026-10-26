-- Migration 0147: transfer risk forecasts (round 13, W5 / P1.6).
--
-- Predictive geopolitical risk for cross-border transfer declarations:
-- OSIRIS OI Forecast engine output blended with the static conflict-zone
-- risk (osirisClient.getConflictRiskLevel) by
-- server/services/transferRiskForecast.ts.
--
-- transfer_risk_forecasts is an append-only HISTORY table: one row per
-- forecast run (or cache-refresh), keyed logically by (country_iso,
-- created_at) — never updated in place so the full audit trail of what the
-- model said, when, and on what sources is preserved. The 24h per-country
-- forecast cache is implemented as "latest row younger than TTL" (see
-- services/transferRiskForecast.forecastTransferRisk), so reads are pure
-- history lookups.
--
-- Columns:
--   forecast_probability  double precision NULL — null records a run where
--                         OI was unavailable/failed (fail-visible); the
--                         rationale explains why.
--   blended_level         the level actually surfaced to reviewers after
--                         the blending rules (static critical preserved;
--                         p>=0.6 upgrades one level; p<0.2 keeps static).
--   sources               jsonb array of source objects preserved VERBATIM
--                         from OI (auditable provenance).
--   model_key_present     whether OSIRIS_OI_KEY was configured at run time
--                         (key custody is server-side env-only; the key
--                         itself is NEVER stored).
--   prediction_id         nullable uuid linking to the decision_feedback
--                         baseline minted at run time (surface
--                         'transfer_forecast') so officer agree/disagree
--                         outcomes join back to the exact model reading.
--
-- Consumed by server/services/transferRiskForecast.ts and
-- server/routers/transferForecast.ts. Idempotent: safe to re-run.
-- PostgreSQL only.

CREATE TABLE IF NOT EXISTS transfer_risk_forecasts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso          TEXT NOT NULL,
  static_risk          TEXT NOT NULL
    CHECK (static_risk IN ('critical', 'high', 'elevated', 'none')),
  forecast_probability DOUBLE PRECISION
    CHECK (forecast_probability IS NULL OR (forecast_probability >= 0 AND forecast_probability <= 1)),
  blended_level        TEXT NOT NULL
    CHECK (blended_level IN ('critical', 'high', 'elevated', 'none')),
  rationale            TEXT NOT NULL DEFAULT '',
  sources              JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_key_present    BOOLEAN NOT NULL DEFAULT FALSE,
  prediction_id        UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_risk_forecasts_country_latest
  ON transfer_risk_forecasts (country_iso, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transfer_risk_forecasts_created
  ON transfer_risk_forecasts (created_at DESC);
